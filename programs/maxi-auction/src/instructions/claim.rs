use crate::{
    account::{Auction, GlobalInfo},
    constants::{AUCTION_SOL_SEED, GLOBAL_INFO_SEED},
    errors::CustomError,
    events::Claimed,
    helper::{get_status_and_clearing_price},
    states::AuctionStatus,
    processor::sol_transfer_with_signer,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer},
};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub caller: Signer<'info>,

    // The token mint of the SPL token being auctioned
    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = caller
    )]
    pub caller_token_account: Account<'info, TokenAccount>,

    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    /// CHECK: Safe. The SPL token program.
    pub token_program: Program<'info, Token>,

    #[account(address = associated_token::ID)]
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

//
// for finished auctions:
// returns the bidder's SPL tokens AND the bidder's sol change (if auction finished in success state); or
//                the bidder's net sol in full (exc. bid fees) (if auction finished in fail state)
//
//  - only available after the auction has finished
//
impl<'info> Claim<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let auction_id = auction.id;
        let auction_bump = auction.bump;
        let lock_percent = auction.lock_percent;
        let min_total_sol = self.global_info.config.min_total_sol;

        // Get clearing price & status for this auction
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(auction, Clock::get().unwrap().unix_timestamp, min_total_sol);
        let clearing_price = clearing_price_wrapped.unwrap_or(0);

        // update auction finished flag - the flag can remain unset by bid() if the status is FailedNotFullyAllocated
        if Clock::get().unwrap().unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
        }

        // Abort if the auction has not finished
        require!(auction.is_finished, CustomError::AuctionNotFinished);

        // Find the bid for the caller - only let him claim once!
        let bid_opt = auction
            .bids
            .iter_mut()
            .find(|b| b.bidder == self.caller.key());
        if bid_opt.is_none() {
            return err!(CustomError::NoBidFoundForCaller);
        }
        let bid = bid_opt.unwrap();
        if bid.is_claimed {
            return err!(CustomError::BidAlreadyClaimed);
        }

        let claim_token_qty;
        if auction_status == AuctionStatus::Succeeded {
            if clearing_price == 0 { return err!(CustomError::InvalidClearingPrice); }

            if bid.bid_sol > clearing_price {
                let paid = bid.bid_qty * bid.bid_sol - bid.bid_fee;
                let exact = bid.bid_qty * clearing_price;
                let owed = paid.saturating_sub(exact);
                msg!("exact: {}", exact);
                msg!("owed: {}", owed);
                msg!("exact: {}", exact);
                
                // return sol change
                sol_transfer_with_signer(
                    self.auction_sol_account.to_account_info(),
                    self.caller.to_account_info(),
                    self.system_program.to_account_info(),
                    &[&[
                        AUCTION_SOL_SEED.as_ref(),
                        auction_id.to_le_bytes().as_ref(),
                        &[auction_bump],
                    ]],
                    owed,
                )?;
            }

            // return tokens
            require!(lock_percent <= 1000, CustomError::InvalidLockPercent); // calculate claimable tokens: apply inverse of lock_percent
            claim_token_qty = (bid.bid_qty as u128 * (1000 - lock_percent as u128) / 1000) as u64;
            let cpi_accounts = SplTransfer {
                from: self.auction_token_account.to_account_info(),
                to: self.caller_token_account.to_account_info(),
                authority: self.auction_sol_account.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    self.token_program.to_account_info(),
                    cpi_accounts,
                    &[&[
                        AUCTION_SOL_SEED.as_ref(),
                        auction_id.to_le_bytes().as_ref(),
                        &[auction_bump],
                    ]],
                ),
                claim_token_qty,
            )?;
        }
        else {
            // return all sol paid, net of bid fees
            let paid = bid.bid_qty * bid.bid_sol - bid.bid_fee;
            sol_transfer_with_signer(
                self.auction_sol_account.to_account_info(),
                self.caller.to_account_info(),
                self.system_program.to_account_info(),
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
                paid,
            )?;

            // tokens remain in the auction account
            claim_token_qty = 0;
        }

        bid.is_claimed = true;
        emit!(Claimed {
            auction_id,
            bidder: self.caller.key(),
            claim_qty: claim_token_qty,
        });

        // Update status & clearing price
        //let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(auction, Clock::get().unwrap().unix_timestamp, self.global_info.config.min_total_sol);
        msg!("updated auction_status: {:?}", auction_status);
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);

        Ok(())
    }
}
