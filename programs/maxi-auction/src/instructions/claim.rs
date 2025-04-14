use crate::{
    account::{Auction, GlobalInfo},
    constants::{AUCTION_SOL_SEED, GLOBAL_INFO_SEED},
    errors::CustomError,
    events::Claimed,
    helper::get_auction_clearing_price,
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

impl<'info> Claim<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let auction_id = auction.id;
        let auction_bump = auction.bump;
        msg!("Calling claim...");
        require!(auction.is_finished, CustomError::AuctionNotFinished);

        // Re-entrancy / concurrency guard
        require!(!auction.is_locked, CustomError::ReentrancyGuard);
        auction.is_locked = true;

        // Get clearing price for this auction:
        let clearing_price_sol = get_auction_clearing_price(auction);
        if clearing_price_sol.is_none() {
            return err!(CustomError::InvalidClearingPrice);
        }
        let clearing_price = clearing_price_sol.unwrap();

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

        if bid.bid_sol > clearing_price {
            let paid = bid.bid_qty * bid.bid_sol;
            let exact = bid.bid_qty * clearing_price;
            let owed = paid.saturating_sub(exact);

            // Returns the excess amount of SOL sent by the user.
            msg!("sending excess sol to {}", bid.bidder);
            let _ = sol_transfer_with_signer(
                self.auction_sol_account.to_account_info(),
                self.caller.to_account_info(),
                self.system_program.to_account_info(),
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
                owed,
            );
        }

        let claimable_qty = bid.bid_qty * 10u64.pow(self.token_mint.decimals as u32);

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
            claimable_qty,
        )?;

        msg!("Succesfully sent splToken");

        bid.is_claimed = true;

        emit!(Claimed {
            auction_id,
            bidder: self.caller.key(),
            claim_qty: claimable_qty,
        });

        auction.is_locked = false;
        Ok(())
    }
}
