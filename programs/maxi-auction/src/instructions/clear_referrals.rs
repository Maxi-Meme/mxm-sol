// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Admin-only instruction to clear all referral mappings (dev/test networks only)
// Resets the referral mappings vector to empty, useful for testing or maintenance
// Blocked on mainnet to prevent accidental data loss

use crate::{
    account::{GlobalInfo, ReferralMappings},
    constants::{GLOBAL_INFO_SEED, REFERRAL_MAPPINGS_SEED},
    errors::CustomError,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DevClearReferrals<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(
        mut,
        address = global_info.config.admin
    )]
    pub admin: Signer<'info>,

    // [REF] - Global referral mappings account to clear
    #[account(
        mut,
        seeds = [REFERRAL_MAPPINGS_SEED],
        bump
    )]
    pub referral_mappings: Account<'info, ReferralMappings>,
}

impl<'info> DevClearReferrals<'info> {
    // [REF] - Process the dev_clear_referrals instruction
    pub fn process(&mut self) -> Result<()> {
        // [REF] - Validate that admin is calling this function
        require!(
            self.admin.key() == self.global_info.config.admin,
            CustomError::Unauthorized
        );

        // [REF] - Block on mainnet builds only
        #[cfg(feature = "mainnet")]
        {
            msg!("[REF] dev_clear_referrals blocked on mainnet build");
            return err!(CustomError::Unauthorized);
        }

        // [REF] - Clear all referral mappings
        let mappings_count = self.referral_mappings.referrals.len();
        self.referral_mappings.referrals.clear();
        
        msg!("[REF] dev_clear_referrals - Cleared {} referral mappings on non-mainnet", mappings_count);

        Ok(())
    }
}
