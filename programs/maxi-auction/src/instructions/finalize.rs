use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError,
    account::GlobalInfo, constants::GLOBAL_INFO_SEED, 
    states::AuctionStatus,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use solana_program::program::invoke_signed;
use anchor_lang::{solana_program, system_program};

#[derive(Accounts)]
pub struct Finalize<'info> {
    /// The global info account containing configuration details like admin and fee account addresses.
    #[account(
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    /// The admin account, must be a signer and match the admin address in global_info.
    #[account(
        mut,
        address = global_info.config.admin @ CustomError::Unauthorized
    )]
    pub admin: Signer<'info>,

    /// The fee account, must be a signer and match the fee account address in global_info.
    #[account(
        mut,
        address = global_info.config.fee_account @ CustomError::Unauthorized
    )]
    pub fee_account: Signer<'info>,

    /// CLOSE DATA ACCOUNT!
    /// The auction data account, mutable and SET TO CLOSE, transferring lamports to admin.
    #[account(mut, close = admin)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// The auction SOL account (PDA), manually verified, holds the SOL to be withdrawn.
    /// CHECK: This account is manually verified in the process function.
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// The token account holding the auction's tokens, mutable for withdrawal.
    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    /// The admin's token account to receive the tokens, mutable for deposit.
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,

    /// The SPL Token program for token transfers.
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// The System program for SOL transfers.
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> Finalize<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let auction_id = auction.id;
        let bump = auction.bump;

        // Verify that auction_sol_account is the correct PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[AUCTION_SOL_SEED.as_ref(), auction_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected_pda, self.auction_sol_account.key(), CustomError::InvalidPDA);

        // withdraw all tokens
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
        token::close_account( // close & reclaim rent-exempt SOL
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

        // withdraw all SOL 
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

        // Update auction status and flags
        auction.last_status = AuctionStatus::Finalized;
        auction.is_finished = true;
        auction.is_tokens_withdrawn = true;
        auction.is_sol_withdrawn = true;
        auction.is_finalized = true;

        Ok(())
    }
}