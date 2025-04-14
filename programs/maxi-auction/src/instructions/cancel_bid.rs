use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError, events::BidCancelled,
    processor::sol_transfer_with_signer,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelBid<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: no checks needed, just program's account
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
        msg!(
            "Calling cancel_bid for auction {}",
            self.auction_data_account.id
        );
        let auction = &mut self.auction_data_account;
        let caller = self.caller.key();
        require!(!auction.is_finished, CustomError::AuctionEnded);

        let bid_opt = auction.bids.iter_mut().find(|b| b.bidder == caller);
        if bid_opt.is_none() {
            return err!(CustomError::NoBidFoundForCaller);
        }
        let bid = bid_opt.unwrap();
        msg!("sending sol to {}", bid.bidder);

        let amount = bid
            .bid_qty
            .checked_mul(bid.bid_sol)
            .ok_or(CustomError::CalculationError)?;

        let _ = sol_transfer_with_signer(
            self.auction_sol_account.clone().to_account_info(),
            self.caller.to_account_info(),
            self.system_program.to_account_info(),
            &[&[
                AUCTION_SOL_SEED.as_ref(),
                auction.id.to_le_bytes().as_ref(),
                &[auction.bump],
            ]],
            amount,
        );

        // Remove the bid from the auction bids array
        auction.bids.retain(|b| b.bidder != caller);
        msg!("Bid removed for caller: {}", caller);

        emit!(BidCancelled {
            auction_id: auction.id,
            bidder: caller,
        });

        Ok(())
    }
}
