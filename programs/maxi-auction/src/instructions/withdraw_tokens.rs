use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError,
    account::GlobalInfo, constants::GLOBAL_INFO_SEED, 
    //states::Config,
};
use anchor_spl::token::{self, Token, TokenAccount};
//use anchor_lang::{system_program, prelude::*};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
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

    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// CHECK: This account is manually verified
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    // #[account(
    //     mut,
    //     associated_token::mint = auction_data_account.token_mint,
    //     associated_token::authority = auction_sol_account
    // )]
    //pub auction_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    // #[account(
    //     mut,
    //     associated_token::mint = auction_data_account.token_mint,
    //     associated_token::authority = admin
    // )]
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,
    //pub admin_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

//
// TODO: only withdraw locked tokens!!
//
impl<'info> WithdrawTokens<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &self.auction_data_account;
        let auction_id = auction.id;
        let bump = auction.bump;

        // Verify auction_sol_account is the correct PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[AUCTION_SOL_SEED.as_ref(), auction_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected_pda, self.auction_sol_account.key(), CustomError::InvalidPDA);

        // Get the token balance
        let token_balance = self.auction_token_account.amount;

        // Ensure lock_percent is valid (0 to 1000)
        require!(auction.lock_percent <= 1000, CustomError::InvalidLockPercent);
        
        // Calculate amount to transfer: (token_balance * lock_percent) / 1000
        let amount_to_transfer = ((token_balance as u128) * (auction.lock_percent as u128) / 1000) as u64;

        // Transfer all tokens to admin's token account
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
            amount_to_transfer,
        )?;

        Ok(())
    }
}