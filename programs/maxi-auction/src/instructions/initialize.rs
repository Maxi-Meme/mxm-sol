use crate::{account::GlobalInfo, constants::GLOBAL_INFO_SEED, states::Config};
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
        space= 8 + size_of::<GlobalInfo>()
    )]
    pub global_info: Account<'info, GlobalInfo>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> Initialize<'info> {
    pub fn process(&mut self, config: Config) -> Result<()> {
        msg!("Calling initialize...");

        self.global_info.deployer = self.signer.key();
        self.global_info.config = config;

        Ok(())
    }
}
