use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError, events::BidCancelled,
    constants::{GLOBAL_INFO_SEED,},
    account::{GlobalInfo},
    helper::get_status_and_clearing_price,
    processor::sol_transfer_with_signer,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelBid<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: No checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

//
// for ongoing auctions:
// returns the bidder's SOL - only available during the auction timespan
//
impl<'info> CancelBid<'info> { 
    pub fn process(&mut self) -> Result<()> {
        //msg!("Calling cancel_bid for auction {}", self.auction_data_account.id);
        let auction = &mut self.auction_data_account;
        let caller = self.caller.key();

        // Abort if the auction has finished (any state)
        require!(!auction.is_finished, CustomError::AuctionEnded);

        // Abort if liquidity has already been moved
        require!(!(auction.bids.len() > 0 && self.auction_sol_account.lamports() == 0), CustomError::AuctionLiquidityMoved);

        // Find the index of the caller's bid
        let bid_index = auction.bids.iter().position(|b| b.bidder == caller);
        if bid_index.is_none() {
            return err!(CustomError::NoBidFoundForCaller);
        }
        let bid_index = bid_index.unwrap();
        let bid = &auction.bids[bid_index];

        //msg!("Sending SOL to bidder: {}", bid.bidder);
        //msg!("bid.bid_qty: {}", bid.bid_qty);
        //msg!("bid.bid_sol: {}", bid.bid_sol);
        //msg!("bid.bid_fee: {}", bid.bid_fee);

        // Calculate refund amount with overflow/underflow protection
        let product = bid.bid_qty
            .checked_mul(bid.bid_sol)
            .ok_or(CustomError::CalculationError)?;
        let refund_amount = product
            .checked_sub(bid.bid_fee)
            .ok_or(CustomError::CalculationError)?;
        //msg!("refund_amount: {}", refund_amount);

        // Transfer the refund back to the caller
        sol_transfer_with_signer(
            self.auction_sol_account.clone().to_account_info(),
            self.caller.to_account_info(),
            self.system_program.to_account_info(),
            &[&[
                AUCTION_SOL_SEED.as_ref(),
                auction.id.to_le_bytes().as_ref(),
                &[auction.bump],
            ]],
            refund_amount,
        )?;

        // Remove the specific bid
        auction.bids.remove(bid_index);

        // Emit the cancellation event
        emit!(BidCancelled {
            auction_id: auction.id,
            bidder: caller,
        });

        // Update status & clearing price
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(auction, Clock::get().unwrap().unix_timestamp, self.global_info.config.min_total_sol);
        msg!("updated auction_status: {:?}", auction_status);
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);

        Ok(())
    }
}