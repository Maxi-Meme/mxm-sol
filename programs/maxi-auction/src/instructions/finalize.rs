// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Final cleanup after all claims processed, prepares for Raydium pool creation
// Only callable after auction ends and all bids claimed, transfers remaining SOL/tokens to admin
// Sets is_finalized flag preventing further operations, auction data remains for historical queries

use crate::{
    account::{Auction, GlobalInfo, Bids},
    constants::{AUCTION_SOL_SEED, GLOBAL_INFO_SEED, BIDS_SEED, AUCTION_DATA_SEED},
    errors::CustomError,
    states::AuctionStatus,
    helper::get_status_and_clearing_price
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use anchor_lang::solana_program;
use solana_program::program::invoke_signed;


#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(
        mut,
        address = global_info.config.admin @ CustomError::Unauthorized
    )]
    pub admin: Signer<'info>,

    /// CHECK: auction_data_account - validated as PDA in instruction logic
    #[account(mut, close = admin)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    // Added Bids account and closed it to reclaim rent
    #[account(mut, close = admin, seeds = [BIDS_SEED.as_ref(), auction_data_account.id.to_le_bytes().as_ref()], bump)]
    pub bids_account: Account<'info, Bids>,

    /// CHECK: auction_sol_account - validated as PDA in instruction logic
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,


    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> Finalize<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction_id = self.auction_data_account.id;
        let bump = self.auction_data_account.bump;

        // Verify correct PDAs
        let (expected_pda, _) = Pubkey::find_program_address(&[AUCTION_SOL_SEED.as_ref(), auction_id.to_le_bytes().as_ref()], &crate::ID,);
        require_keys_eq!(expected_pda, self.auction_sol_account.key(), CustomError::InvalidPDA);

        let (expected_pda, _) = Pubkey::find_program_address(&[AUCTION_DATA_SEED.as_ref(), auction_id.to_le_bytes().as_ref()], &crate::ID,);
        require_keys_eq!(expected_pda, self.auction_data_account.key(), CustomError::InvalidPDA);

        let auction = &mut self.auction_data_account;

        if Clock::get()?.unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
            msg!("finalize - Auction marked as finished");
        }

        // require that the auction is finished, not already finalized & all bids claimed
        require!(!auction.is_finalized, CustomError::AuctionAlreadyFinalized);
        require!(auction.is_finished, CustomError::AuctionNotFinished);
        for bid in &self.bids_account.bids {
            require!(bid.is_claimed, CustomError::InvalidState);
        }

         // update current status
        let (current_status, _) = get_status_and_clearing_price(
            auction,
            &self.bids_account.bids,
            Clock::get()?.unix_timestamp,
            self.global_info.config.min_total_sol,
        )?;
        auction.last_status = current_status;

        let token_balance = self.auction_token_account.amount;
        token::transfer(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                token::Transfer {
                    from: self.auction_token_account.to_account_info(),
                    to: self.admin_token_account.to_account_info(),
                    authority: self.auction_sol_account.to_account_info(),
                },
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[bump],
                ]],
            ),
            token_balance,
        )?;
        token::close_account(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                token::CloseAccount {
                    account: self.auction_token_account.to_account_info(),
                    destination: self.admin.to_account_info(),
                    authority: self.auction_sol_account.to_account_info(),
                },
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[bump],
                ]],
            ),
        )?;

        let sol_balance = self.auction_sol_account.lamports();
        if sol_balance > 0 {
            let transfer_instruction = solana_program::system_instruction::transfer(
                &self.auction_sol_account.key,
                &self.admin.key,
                sol_balance,
            );
            invoke_signed(
                &transfer_instruction,
                &[
                    self.auction_sol_account.clone(),
                    self.admin.to_account_info(),
                    self.system_program.to_account_info(),
                ],
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[bump],
                ]],
            )?;
        }

        auction.last_status = AuctionStatus::Finalized;
        auction.is_finished = true;
        auction.is_tokens_withdrawn = true;
        auction.is_sol_withdrawn = true;
        auction.is_finalized = true;

        Ok(())
    }
}