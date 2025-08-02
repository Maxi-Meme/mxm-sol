use crate::{account::GlobalInfo, constants::GLOBAL_INFO_SEED, states::Config, errors::CustomError};
use anchor_lang::prelude::*;
use core::mem::size_of;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed, //init,
        payer=signer,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
        space= 8 + size_of::<GlobalInfo>() + 200 // Extra space for fee_accounts Vec with FeeAccount structs
    )]
    pub global_info: Account<'info, GlobalInfo>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> Initialize<'info> {
    pub fn process(&mut self, config: Config) -> Result<()> {
        msg!("Calling initialize...");

        // Validate fee accounts percentages sum to exactly 10000 (100%)
        let mut total_percentage: u64 = 0;
        for fee_account in &config.fee_accounts {
            total_percentage = total_percentage
                .checked_add(fee_account.share)
                .ok_or(CustomError::Overflow)?;
        }
        
        require!(
            total_percentage == 10000,
            CustomError::InvalidFeeAccountPercentages
        );

        self.global_info.deployer = self.signer.key();

        msg!("Supplied config.min_total_sol: {:?}", config.min_total_sol);
        msg!("Fee accounts count: {}", config.fee_accounts.len());
        msg!("Fee accounts total percentage: {}", total_percentage);
        
        self.global_info.config = config;

        Ok(())
    }
}
