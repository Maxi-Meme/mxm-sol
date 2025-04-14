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
        self.global_info.config = new_config;

        Ok(())
    }
}
