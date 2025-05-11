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

impl<'info> CancelBid<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let caller = self.caller.key();
        require!(!auction.is_admin_aborted, CustomError::AuctionAdminAborted);

        // Update and log auction finished status
        if Clock::get()?.unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
            msg!("cancel_bid - Auction marked as finished");
        }
        
        // Abort if the auction has finished
        require!(!auction.is_finished, CustomError::AuctionEnded);

        // Abort if liquidity has already been moved
        require!(
            !(auction.bids.len() > 0 && self.auction_sol_account.lamports() == 0),
            CustomError::AuctionLiquidityMoved
        );

        let mut total_refund: u64 = 0;
        let mut bids_cancelled = 0;
        let mut i = 0;

        // Iterate through the bids and remove all bids from the caller
        while i < auction.bids.len() {
            if auction.bids[i].bidder == caller {
                let bid = auction.bids.remove(i);
                // Calculate refund: (quantity * price) - fee
                let product = bid.bid_qty
                    .checked_mul(bid.bid_sol)
                    .ok_or(CustomError::CalculationError)?;
                let refund_amount = product
                    .checked_sub(bid.bid_fee)
                    .ok_or(CustomError::CalculationError)?;
                total_refund = total_refund
                    .checked_add(refund_amount)
                    .ok_or(CustomError::CalculationError)?;
                bids_cancelled += 1;
                // Do not increment i since the next element shifts into the current position
            } else {
                i += 1;
            }
        }

        // If no bids were found for the caller, return an error
        if bids_cancelled == 0 {
            return err!(CustomError::NoBidFoundForCaller);
        }

        // Transfer the total refund to the caller in one transaction
        sol_transfer_with_signer(
            self.auction_sol_account.clone().to_account_info(),
            self.caller.to_account_info(),
            self.system_program.to_account_info(),
            &[&[
                AUCTION_SOL_SEED.as_ref(),
                auction.id.to_le_bytes().as_ref(),
                &[auction.bump],
            ]],
            total_refund,
        )?;

        // Emit a single event indicating the caller's bids were cancelled
        emit!(BidCancelled {
            auction_id: auction.id,
            bidder: caller,
        });

        // Update auction status and clearing price based on remaining bids
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
            auction,
            Clock::get().unwrap().unix_timestamp,
            self.global_info.config.min_total_sol,
        );
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("cancel_bid - updated auction_status: {:?}", auction.last_status);

        Ok(())
    }
}