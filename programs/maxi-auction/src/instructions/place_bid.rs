use crate::{
    account::{Auction, GlobalInfo},
    constants::{GLOBAL_INFO_SEED, MAX_BIDS, AUCTION_DATA_SEED, AUCTION_SOL_SEED},
    errors::CustomError,
    states::AuctionStatus,
    events::{AuctionFilled, NewBid},
    helper::{get_current_price, get_remaining_tokens, get_net_sol_raised},
    helper::{get_status_and_clearing_price},
    processor::sol_transfer_user,
    states::Bid,
};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    metadata::{self, mpl_token_metadata::types::DataV2, Metadata},
    token::{self, spl_token::instruction::AuthorityType, Mint, Token, TokenAccount},
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::rent::Rent;

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        address = global_info.config.admin
    )]
    pub admin: Signer<'info>,

    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// CHECK: Revenue account to receive the 1% fee
    #[account(
        mut,
        address = global_info.config.fee_account
    )]
    pub fee_account: AccountInfo<'info>,    

    #[account(mut)] 
    pub token_mint: Account<'info, Mint>,

    /// CHECK: The auction's token account (PDA) that holds the auctioned tokens
    #[account(mut)] 
    pub auction_token_account: Account<'info, TokenAccount>,

    #[account(address = anchor_lang::system_program::ID)]
    system_program: Program<'info, System>,

    #[account(address = token::ID)]
    token_program: Program<'info, Token>,
}

impl<'info> PlaceBid<'info> {
    pub fn process(&mut self, bid_quantity: u64, x_id: u64, fee_perc: u64) -> Result<()> {
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(0);

        let auction = &mut self.auction_data_account;
        let default_start_price = self.global_info.config.default_start_price_lamports;
        require!(!auction.is_finalized, CustomError::AuctionAlreadyFinalized);

        
        
        // Validate bid and auction state
        require!(auction.bids.len() < MAX_BIDS, CustomError::MaxBidsReached);
        require!(bid_quantity > 0, CustomError::InvalidBidQuantity);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= auction.start_timestamp, CustomError::AuctionNotStarted);
        require!(!auction.is_finished, CustomError::AuctionEnded);
        require!(
            !(auction.bids.len() > 0 && self.auction_sol_account.lamports() == 0),
            CustomError::AuctionLiquidityMoved
        );

        // Calculate current price and remaining tokens
        let mut current_price = get_current_price(auction, clock.unix_timestamp, default_start_price)
            .unwrap_or(default_start_price);
        let remaining_tokens = get_remaining_tokens(auction);
        require!(bid_quantity <= remaining_tokens, CustomError::NotEnoughTokensLeft);

        // Calculate initial total cost
        let mut total_cost = bid_quantity.checked_mul(current_price).ok_or(CustomError::Overflow)?;
        require!(fee_perc < 10000, CustomError::InvalidFeePercentage);
        let mut fee = ((total_cost as u128 * fee_perc as u128) / 10000) as u64;
        // let mut fee = 0; // testing zero fees
        let mut auction_amount = total_cost - fee;

        // Adjust total_cost if auction_amount is below min_rent
        if auction_amount < min_rent {
            let mut low = total_cost; 
            let mut high = u64::MAX;
            while low < high { // All hail Grok
                let mid = low + (high - low) / 2;
                let f = ((mid as u128 * fee_perc as u128) / 10000) as u64;
                let a = mid - f;
                if a >= min_rent {
                    high = mid;
                } else {
                    low = mid + 1;
                }
            }
            total_cost = low;
            msg!("place_bid - bumping total_cost to {} to cover min rent", total_cost);

            // Calculate adjusted current_price (ceiling division)
            current_price = (total_cost + bid_quantity - 1) / bid_quantity;

            // Recalculate total_cost, fee, and auction_amount with adjusted current_price
            total_cost = bid_quantity.checked_mul(current_price).ok_or(CustomError::Overflow)?;
            fee = ((total_cost as u128 * fee_perc as u128) / 10000) as u64;
            auction_amount = total_cost - fee;
        }

        // Log the values for debugging
        msg!("place_bid - bid_quantity: {}", bid_quantity);
        msg!("place_bid - current_price: {}", current_price);
        msg!("place_bid - remaining_tokens: {}", remaining_tokens);
        msg!("place_bid - total_cost: {}", total_cost);
        msg!("place_bid - auction_amount: {}", auction_amount);
        msg!("place_bid - fee_perc: {}", fee_perc);
        msg!("place_bid - fee: {}", fee);
        msg!("place_bid - min_rent: {}", min_rent);

        // Transfer auction amount to auction_sol_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.auction_sol_account.to_account_info(),
            self.system_program.to_account_info(),
            auction_amount,
        )?;

        // Transfer fee to fee_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.fee_account.to_account_info(),
            self.system_program.to_account_info(),
            fee,
        )?;

        // Record the bid with adjusted current_price and fee
        auction.bids.push(Bid {
            bidder: self.bidder.key(),
            x_id,
            bid_timestamp: clock.unix_timestamp,
            bid_qty: bid_quantity,
            bid_sol: current_price,
            is_claimed: false,
            bid_fee: fee,
        });

        // Emit bid event
        emit!(NewBid {
            auction_id: auction.id,
            bidder: self.bidder.key(),
            x_id,
            bid_qty: bid_quantity,
            bid_sol: current_price,
            bid_fee: fee,
        });

        // Check if auction is fully allocated
        if remaining_tokens - bid_quantity == 0 {
            auction.is_finished = true;
            emit!(AuctionFilled {
                auction_id: auction.id,
            });

            //
            // Auction succeeds if:
            //   1. All tokens are sold;
            //   2. and by implication, clearing price > 0
            //
            let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
                auction,
                clock.unix_timestamp,
                self.global_info.config.min_total_sol,
            );
            if auction_status == AuctionStatus::Succeeded {
                let clearing_price = clearing_price_wrapped.unwrap_or(0);
                if clearing_price == 0 {
                    return err!(CustomError::InvalidClearingPrice);
                }

                auction.net_sol_raised = get_net_sol_raised(auction, clearing_price, 0, self.auction_sol_account.lamports())?;

                //
                // Method (3) -- todo??
                //   Combine 1 & 2
                //      Mint a (*fixed* this time) amount of tokens at auction end, and use that (instead of 1-dist_percent)
                //      to calculate what fraction of net SOL raised needs to go into the pool to yield the clearing price.
                //
                //  Then we can set dist_percent to 100%, for a cleaner user experience (1 token bid = 1 token received)
                //
                //...

                //
                // Method (2) calculate what fraction of the net SOL raised has to be put in the liquidity pool, to achieve the given clearing price.
                //
                //  S = P * T
                //    where S is amount of SOL to put in the pool, and P is the settlement price, 
                //     and T is the amount of liquidity tokens already locked.
                //    e.g. for T = 3, P = 0.000861112: S = 0.002583336
                //
                let token_balance = self.auction_token_account.amount; // smallest token units
                let dist_percent = auction.dist_percent; // 0 to 10000
                let token_decimals = auction.token_decimals as u32;

                // Calculate T (locked tokens) as in WithdrawTokens
                let locked_tokens = token_balance
                    .checked_mul(10000 - dist_percent)
                    .ok_or(CustomError::Overflow)?
                    .checked_div(10000)
                    .ok_or(CustomError::Overflow)?;


                // Calculate S = (P * T) / 10^token_decimals
                let s_lamports = (clearing_price as u128)
                    .checked_mul(locked_tokens as u128)
                    .ok_or(CustomError::Overflow)?
                    .checked_div(10u128.pow(token_decimals))
                    .ok_or(CustomError::Overflow)?
                    as u64;

                // ### this MUST MATCH the fixed amount in migrate-auction.ts!
                let FIXED_SOL_RAYDIUM_COSTS = 25000; // test low devenet value - ~250000000 for mainnet value ~0.25 sol
                //let FIXED_SOL_RAYDIUM_COSTS = 0; // testing zero fees
                auction.liquidity_sol = s_lamports + FIXED_SOL_RAYDIUM_COSTS;
                
                msg!("place_bid final - P (lamports per whole token [clearing_price]): {}", clearing_price);
                msg!("place_bid final - T (smallest token units [locked_tokens]): {}", locked_tokens);
                msg!("place_bid final - S (lamports [base sol for liquidity - s_lamports]): {}", s_lamports);
                msg!("place_bid final - (vs get_net_sol_raised): {}", auction.net_sol_raised);
                msg!("place_bid final - FIXED_SOL_RAYDIUM_COSTS: {}", FIXED_SOL_RAYDIUM_COSTS);
                msg!("place_bid final - liquidity_sol [base sol for liquidity + fixed raydium costs]: {}", auction.liquidity_sol);

                // calculate buyback price for bidders - we buy back from unused raised sol (sol raised but not used for liquidity)
                let unlocked_tokens = token_balance.checked_sub(locked_tokens).ok_or(CustomError::Underflow)?;
                msg!("place_bid final - unlocked_tokens: {}", unlocked_tokens);
                if unlocked_tokens > 0 {
                    let diff = auction.net_sol_raised
                        .checked_sub(auction.liquidity_sol)
                        .ok_or(CustomError::Underflow)?;
                    if diff > 0 {
                        let buyback_price = (diff as u128)
                            .checked_mul(10u128.pow(auction.token_decimals as u32))
                            .ok_or(CustomError::Overflow)?
                            .checked_div(unlocked_tokens as u128)
                            .ok_or(CustomError::Overflow)?
                            as u64;
                        auction.buyback_price = buyback_price;
                        msg!("place_bid final - adjusted buyback_price (lamports per whole token): {}", buyback_price);
                    } else {
                        auction.buyback_price = 0;
                        msg!("place_bid final - no SOL left for buyback, buyback_price set to 0");
                    }
                } else {
                    auction.buyback_price = 0;
                    msg!("place_bid final - no unlocked tokens, buyback_price set to 0");
                }
                //
                // TODO: buyback() method - only for bidders... send tokens rec'd to DAO wallet... 
                // TODO: DAO access method - admin method to access unused sol after n days... time limit on buyback... auction param.
                //

                //
                // Method (1) "overmint" -- mint more tokens, so all SOL raised can be put into the liquidity pool, to achieve the given clearing price. 
                //
                //  T = S / P
                //    where S is the net SOL raised, and P is the settlement price. 
                //    e.g. for S = 0.084317208, P = 0.000861112: T = 97.91
                //
                /*let s_lamports = get_net_sol_raised(auction, clearing_price, 0, self.auction_sol_account.lamports())?; // S

                // Calculate T_units: T = S / P, adjusted for decimals
                let token_decimals = auction.token_decimals as u32;
                let t_units = ((s_lamports as u128) // T
                    .checked_mul(10u128.pow(token_decimals))
                    .ok_or(CustomError::Overflow)?  // Check multiplication overflow
                    / (clearing_price as u128))     // Perform division directly
                    as u64;                         // Cast to u64
              
                msg!("place_bid final - P - clearing_price: {}", clearing_price);
                msg!("place_bid final - S - s_lamports: {}", s_lamports);
                msg!("place_bid final - token_decimals: {}", token_decimals);
                msg!("place_bid final - T - t_units: {}", t_units);

                // +0.5%
                let adjusted_t_units = (t_units as u128)
                    .checked_mul(1005)
                    .and_then(|x| x.checked_div(1000))
                    .ok_or(CustomError::Overflow)? as u64;

                let adjusted_t_units = t_units;

                // Mint T_units to auction_token_account
                auction.liquidity_overmint = adjusted_t_units;
                token::mint_to(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        token::MintTo {
                            mint: self.token_mint.to_account_info(),
                            to: self.auction_token_account.to_account_info(),
                            authority: self.auction_sol_account.to_account_info(),
                        },
                        &[&[
                            AUCTION_SOL_SEED.as_ref(),
                            auction.id.to_le_bytes().as_ref(),
                            &[auction.bump],
                        ]],
                    ),
                    adjusted_t_units,
                )?;
                msg!("Minted {} token units for liquidity", adjusted_t_units);

                //  revoke mint authority
                token::set_authority(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        token::SetAuthority {
                            current_authority: self.auction_sol_account.to_account_info(),
                            account_or_mint: self.token_mint.to_account_info(),
                        },
                        &[&[
                            AUCTION_SOL_SEED.as_ref(),
                            auction.id.to_le_bytes().as_ref(),
                            &[auction.bump],
                        ]],
                    ),
                    AuthorityType::MintTokens,
                    None,
                )?;*/

                // todo: nicer than offchain flow -  interact directly with raydium from here...
                //...
            }
        }

        // Update status & clearing price
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
            auction,
            clock.unix_timestamp,
            self.global_info.config.min_total_sol
        );
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("place_bid - updated auction_status: {:?}", auction.last_status);

        Ok(())
    }
}

// Function to count trailing zeros in a u64
fn count_trailing_zeros(mut num: u64) -> u32 {
    let mut count = 0;
    while num > 0 && num % 10 == 0 {
        count += 1;
        num /= 10;
    }
    count
}
