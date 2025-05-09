use crate::{
    account::{Auction, GlobalInfo},
    constants::{GLOBAL_INFO_SEED, MAX_BIDS},
    errors::CustomError,
    events::{AuctionFilled, NewBid},
    helper::{get_current_price, get_remaining_tokens},
    helper::{get_status_and_clearing_price},
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

    /// CHECK: Revenue account to receive the 1% fee
    #[account(
        mut,
        address = global_info.config.fee_account
    )]
    pub fee_account: AccountInfo<'info>,    

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBid<'info> {
    pub fn process(&mut self, bid_quantity: u64, x_id: u64) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let default_start_price = self.global_info.config.default_start_price_lamports;

        // Validate bid and auction state
        require!(auction.bids.len() < MAX_BIDS, CustomError::MaxBidsReached);
        require!(bid_quantity > 0, CustomError::InvalidBidQuantity);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= auction.start_timestamp, CustomError::AuctionNotStarted);

        // Ensure the auction hasn't ended
        require!(!auction.is_finished, CustomError::AuctionEnded);

        // Abort if liquidity has already been moved
        require!(!(auction.bids.len() > 0 && self.auction_sol_account.lamports() == 0), CustomError::AuctionLiquidityMoved);

        // Calculate current price and remaining tokens
        let current_price = get_current_price(auction, clock.unix_timestamp, default_start_price).unwrap_or(default_start_price);
        let remaining_tokens = get_remaining_tokens(auction);
        require!(bid_quantity <= remaining_tokens, CustomError::NotEnoughTokensLeft);

        // Calculate total cost with overflow protection
        let total_cost = bid_quantity.checked_mul(current_price).ok_or(CustomError::Overflow)?;

        // Calculate 1% fee and amount for auction account
        let fee = total_cost / 100; // 1% fee, integer division rounds down
        //let rent = Rent::get()?.minimum_balance(165); // For an ATA
        //let final_fee = fee.max(rent); // Use the higher of fee or rent        
        let final_fee = fee;
        let auction_amount = total_cost - final_fee;

        /*msg!("bid_quantity: {}", bid_quantity);
        msg!("current_price: {}", current_price);
        msg!("remaining_tokens: {}", remaining_tokens);
        msg!("total_cost: {}", total_cost);
        msg!("auction_amount: {}", auction_amount);
        msg!("final_fee: {}", final_fee);*/

        // auction amount to auction_sol_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.auction_sol_account.to_account_info(),
            self.system_program.to_account_info(),
            auction_amount,
        )?;

        // fee to fee_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.fee_account.to_account_info(),
            self.system_program.to_account_info(),
            final_fee,
        )?;

        // Record the bid
        auction.bids.push(Bid {
            bidder: self.bidder.key(),
            x_id,
            bid_timestamp: clock.unix_timestamp,
            bid_qty: bid_quantity,
            bid_sol: current_price, 
            is_claimed: false,
            bid_fee: final_fee,
        });

        // Emit bid event
        emit!(NewBid {
            auction_id: auction.id,
            bidder: self.bidder.key(),
            x_id,
            bid_qty: bid_quantity,
            bid_sol: current_price,
            bid_fee: final_fee,
        });

        // Check if auction is fully allocated
        if remaining_tokens - bid_quantity == 0 {
            auction.is_finished = true;

            emit!(AuctionFilled {
                auction_id: auction.id,
            });
        }

        // Update status & clearing price
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(auction, Clock::get().unwrap().unix_timestamp, self.global_info.config.min_total_sol);
        msg!("updated auction_status: {:?}", auction_status);
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);

        Ok(())
    }
}
