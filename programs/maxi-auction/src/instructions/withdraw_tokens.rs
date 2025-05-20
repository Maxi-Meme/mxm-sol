use crate::{
    account::{ Auction, GlobalInfo, Bids }, 
    constants::{ GLOBAL_INFO_SEED, AUCTION_SOL_SEED, BIDS_SEED },
    errors::CustomError,
    //states::Config,
    states::AuctionStatus,
    helper::get_status_and_clearing_price,
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

    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,

     #[account(
        mut,
        seeds = [BIDS_SEED.as_ref(), auction_data_account.id.to_le_bytes().as_ref()],
        bump
    )]
    pub bids_account: Account<'info, Bids>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

impl<'info> WithdrawTokens<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let bids = &mut self.bids_account.bids;
        let auction_id = auction.id;
        let bump = auction.bump;

        // Verify auction_sol_account is the correct PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[AUCTION_SOL_SEED.as_ref(), auction_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected_pda, self.auction_sol_account.key(), CustomError::InvalidPDA);

        // Update auction finished flag (consistent with Claim)
        if Clock::get().unwrap().unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
        }
        require!(auction.is_finished, CustomError::AuctionNotFinished);

        // only allow one admin withdraw
        require!(!auction.is_tokens_withdrawn, CustomError::TokensAlreadyWithdrawn);

        // only proceed if auction is successful
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(auction, bids, Clock::get().unwrap().unix_timestamp, self.global_info.config.min_total_sol);
        require!(auction_status == AuctionStatus::Succeeded, CustomError::InvalidState);
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("updated auction_status: {:?}", auction.last_status);

        // Calculate amount to transfer
        let token_balance = self.auction_token_account.amount;
        let mut withdrawable = token_balance
            .checked_mul(10000 - auction.dist_percent)
            .ok_or(CustomError::Overflow)?
            .checked_div(10000)
            .ok_or(CustomError::Overflow)?;

        // overmint - add liquidity_overmint to withdrawable
        //withdrawable = withdrawable.checked_add(auction.liquidity_overmint).ok_or(CustomError::Overflow)?;
            
        msg!("withdrawable {}", withdrawable);
        //msg!("liquidity_overmint {}", auction.liquidity_overmint);
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
            withdrawable,
        )?;
        msg!("Withdrawal successful. Transferred {} tokens to admin.", withdrawable);
        
        auction.is_tokens_withdrawn = true;
        Ok(())
    }
}