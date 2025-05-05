use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError,
    account::GlobalInfo, constants::GLOBAL_INFO_SEED, 
};
use anchor_lang::{prelude::*, solana_program, system_program};
use solana_program::{
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
};

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
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

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawSol<'info> {
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

        // Get the SOL balance
        let balance = self.auction_sol_account.lamports();

        // Transfer all SOL to admin
        let transfer_instruction = solana_program::system_instruction::transfer(      
            &self.auction_sol_account.key,
            &self.admin.key,
            balance,
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

        Ok(())
    }
}

