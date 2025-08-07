// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Updates global system configuration parameters
// Admin-only instruction to change fees, token defaults, min SOL requirements
// Validates fee_accounts sum to 10000, affects all future auctions not existing ones

use crate::{
    account::GlobalInfo, constants::GLOBAL_INFO_SEED, errors::CustomError, states::Config,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetConfig<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
      mut,
      seeds = [GLOBAL_INFO_SEED.as_ref()],
      bump,
  )]
    pub global_info: Account<'info, GlobalInfo>,
}

impl<'info> SetConfig<'info> {
    pub fn process(&mut self, new_config: Config) -> Result<()> {
        msg!("Calling set_config...");

        require!(
            self.caller.key() == self.global_info.deployer,
            CustomError::Unauthorized
        );

        // Validate fee accounts sum to exactly 10000 (100%)
        let mut total_percentage: u64 = 0;
        for fee_account in &new_config.fee_accounts {
            total_percentage = total_percentage
                .checked_add(fee_account.share)
                .ok_or(CustomError::Overflow)?;
        }
        
        require!(
            total_percentage == 10000,
            CustomError::InvalidFeeAccountPercentages
        );

        msg!("Fee accounts total percentage: {}", total_percentage);
        self.global_info.config = new_config;

        Ok(())
    }
}
