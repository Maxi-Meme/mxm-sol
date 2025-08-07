// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Manages referral relationships for fee sharing
// Admin creates/updates mappings linking referred accounts to referrer pubkeys
// When referred account bids, portion of fees go to referrer based on ref_bid_fee_perc_share

// [REF] - Admin-only instruction to set/update referral mappings
use crate::{
    account::{GlobalInfo, ReferralMappings, ReferralMapping},
    constants::{GLOBAL_INFO_SEED, REFERRAL_MAPPINGS_SEED},
    errors::CustomError,
};
use anchor_lang::prelude::*;
use std::mem::size_of;

#[derive(Accounts)]
pub struct SetReferral<'info> {
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

    // [REF] - Global referral mappings account, initialized if needed
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 4 + (32 + 32) * 100, // Account discriminator + Vec length + initial capacity for 100 mappings
        seeds = [REFERRAL_MAPPINGS_SEED],
        bump
    )]
    pub referral_mappings: Account<'info, ReferralMappings>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,

    // Added to calculate rent costs for resizing
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> SetReferral<'info> {
    // [REF] - Process the set_referral instruction
    pub fn process(&mut self, referred_account: Pubkey, referrer_account: Pubkey) -> Result<()> {
        let rent = Rent::get()?;

        // [REF] - Validate that admin is calling this function
        require!(
            self.admin.key() == self.global_info.config.admin,
            CustomError::Unauthorized
        );

        // [REF] - Prevent self-referral
        require!(
            referred_account != referrer_account,
            CustomError::InvalidReferralMapping
        );

        // [REF] - Initialize referrals vector if empty
        if self.referral_mappings.referrals.is_empty() {
            self.referral_mappings.referrals = vec![];
        }

        // [REF] - Check if mapping already exists and update it, or add new mapping
        let mut found = false;
        for mapping in self.referral_mappings.referrals.iter_mut() {
            if mapping.referred_account == referred_account {
                mapping.referrer_account = referrer_account;
                found = true;
                break;
            }
        }

        if !found {
            // [REF] - Check if we need to resize the account for new mapping
            let mapping_size = size_of::<ReferralMapping>();
            let header_space = 8 + 4; // Discriminator (8) + Vec length (4)
            let current_space = self.referral_mappings.to_account_info().data.borrow().len();
            let current_mappings_len = self.referral_mappings.referrals.len();
            let current_capacity = (current_space - header_space) / mapping_size;
            let required_space = header_space + (current_mappings_len + 1) * mapping_size;

            msg!("[REF] set_referral - current_capacity: {}", current_capacity);
            msg!("[REF] set_referral - required_space: {}", required_space);
            msg!("[REF] set_referral - current_mappings_len: {}", current_mappings_len);
            msg!("[REF] set_referral - mapping_size: {}", mapping_size);
            msg!("[REF] set_referral - current_space: {}", current_space);

            if current_mappings_len >= current_capacity {
                // [REF] - Calculate additional space needed (double capacity)
                let new_capacity = if current_capacity == 0 { 10 } else { current_capacity * 2 };
                let new_space = header_space + new_capacity * mapping_size;
                let additional_space = new_space - current_space;
                let additional_rent = rent.minimum_balance(additional_space);

                msg!("[REF] set_referral - Resizing referral_mappings account by {} bytes", additional_space);

                // [REF] - Transfer additional rent from admin to referral_mappings account
                let cpi_context = CpiContext::new(
                    self.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: self.admin.to_account_info(),
                        to: self.referral_mappings.to_account_info(),
                    },
                );
                anchor_lang::system_program::transfer(cpi_context, additional_rent)?;

                // [REF] - Resize the account
                self.referral_mappings.to_account_info().realloc(new_space, false)?;
            }

            // [REF] - Add new referral mapping
            self.referral_mappings.referrals.push(ReferralMapping {
                referred_account,
                referrer_account,
            });
        }

        msg!("[REF] set_referral - Mapped referred_account: {} to referrer_account: {}", 
             referred_account, referrer_account);

        Ok(())
    }
}