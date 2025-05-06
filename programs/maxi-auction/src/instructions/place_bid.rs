use crate::{
    account::{Auction, GlobalInfo},
    constants::{GLOBAL_INFO_SEED, MAX_BIDS},
    errors::CustomError,
    events::{AuctionFilled, NewBid},
    helper::{get_current_price, get_remaining_tokens},
    processor::sol_transfer_user,
    states::Bid,
};
use anchor_lang::prelude::*;

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

    // Auction program account holding SOL (the PDA)
    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBid<'info> {
    pub fn process(&mut self, bid_qty_tokens: u64 /* token units, i.e. can't bid any decimals */, x_id: u64) -> Result<()> {
        //msg!("Calling place_bid for auction {}", self.auction_data_account.id);

        let auction = &mut self.auction_data_account;
        let default_start_price_lamports = self.global_info.config.default_start_price_lamports;

        // Log initial state
        //msg!("Initial bids length: {}", auction.bids.len());
        // msg!("auction_data_account balance: {}", self.auction_data_account.lamports());
        // msg!("auction_data_account data size: {}", self.auction_data_account.data_len());

        require!(auction.bids.len() < MAX_BIDS, CustomError::MaxBidsReached);
        require!(bid_qty_tokens > 0, CustomError::InvalidBidQuantity);

        // Check if auction has started
        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= auction.start_timestamp, CustomError::AuctionNotStarted);

        // ??? intent is: re-entrancy / concurrency guard - how effective is this?!?
        require!(!auction.is_locked, CustomError::ReentrancyGuard);
        auction.is_locked = true;

            let current_price_lamports_per_token = get_current_price(auction, clock.unix_timestamp, default_start_price_lamports).unwrap_or(default_start_price_lamports);
            msg!("current_price_lamports_per_token: {}", current_price_lamports_per_token);

            let remaining_tokens = get_remaining_tokens(auction);
            msg!("bid_qty_tokens: {}", bid_qty_tokens);
            msg!("auction.token_supply: {}", auction.token_supply);
            msg!("remaining_tokens: {}", remaining_tokens);
            require!(bid_qty_tokens <= remaining_tokens, CustomError::NotEnoughTokensLeft);

            // Calculate the total spend
            let total_amount = bid_qty_tokens/*.saturating_div(10u64.pow(auction.token_decimals as u32)))*/ * current_price_lamports_per_token;

            //msg!("calculated amount (bid_qty_tokens * current_price): {}", total_amount);

            // Minimum amount to cover the rent
            //let rent_exempt_minimum: u64 = 10_000_000; // 0.01 SOL to cover the rent
            let amount = /*if total_amount < rent_exempt_minimum {
                msg!("Amount too low to cover the rent. Using the minimum amount: {} lamports", rent_exempt_minimum);
                rent_exempt_minimum
            } else {
                total_amount
            };*/ total_amount;
            msg!("final amount to transfer: {}", amount);

            // transfer from bidder to auction_sol_account
            msg!("bidder balance before transfer: {}", self.bidder.lamports());
            sol_transfer_user(
                self.bidder.to_account_info(),
                self.auction_sol_account.to_account_info(),
                self.system_program.to_account_info(),
                amount,
            )?;
            msg!("bidder balance after transfer: {}", self.bidder.lamports());

            // save & emit the bid
            auction.bids.push(Bid {
                bidder: self.bidder.key(),
                x_id,
                bid_timestamp: clock.unix_timestamp,
                bid_qty: bid_qty_tokens,
                bid_sol: current_price_lamports_per_token,
                is_claimed: false,
            });
            emit!(NewBid {
                auction_id: auction.id,
                bidder: self.bidder.key(),
                x_id,
                bid_qty: bid_qty_tokens,
                bid_sol: current_price_lamports_per_token,
            });

            // check if auction is finished
            if remaining_tokens - bid_qty_tokens == 0 {
                auction.is_finished = true;
                emit!(AuctionFilled {
                    auction_id: auction.id,
                });
            }

        // ???
        auction.is_locked = false;
        Ok(())
    }
}
