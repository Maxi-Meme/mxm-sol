use crate::{
    account::{ Auction, GlobalInfo, Bids }, 
    constants::{ GLOBAL_INFO_SEED, AUCTION_SOL_SEED, BIDS_SEED },
    errors::CustomError,
    states::AuctionStatus,
    helper::{get_status_and_clearing_price, get_net_sol_raised},
};
use anchor_lang::{prelude::*, solana_program, system_program};
use solana_program::{
    program::{invoke_signed},
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
     
    #[account(
        mut,
        seeds = [BIDS_SEED.as_ref(), auction_data_account.id.to_le_bytes().as_ref()],
        bump
    )]
    pub bids_account: Account<'info, Bids>,

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawSol<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let bids = &mut self.bids_account.bids;
        let auction_id = auction.id;
        let bump = auction.bump;

        // Verify auction_sol_account PDA
        let (expected_pda, _) = Pubkey::find_program_address(
            &[AUCTION_SOL_SEED.as_ref(), auction_id.to_le_bytes().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected_pda, self.auction_sol_account.key(), CustomError::InvalidPDA);

        // Auction status and checks
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
            auction, bids,
            Clock::get()?.unix_timestamp,
            self.global_info.config.min_total_sol,
        );
        let clearing_price = clearing_price_wrapped.unwrap_or(0);
        if Clock::get()?.unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
        }
        require!(auction.is_finished, CustomError::AuctionNotFinished);
        require!(!auction.is_sol_withdrawn, CustomError::SolAlreadyWithdrawn);
        
        require!(auction_status != AuctionStatus::FailedMinNotReached, CustomError::MinNotReached);
        require!(auction_status == AuctionStatus::Succeeded, CustomError::InvalidState);
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price;
        msg!("updated auction_status: {:?}", auction.last_status);

        // method 1 - overmint: we withdraw all the sol...
        let amount_to_transfer = get_net_sol_raised(auction, bids, clearing_price, 0, self.auction_sol_account.lamports())?; 

        // method 2 - liq underfund - withdraw the fraction of net sol raised to yield pool starting price = the auction clearing price
        // retain the rest of the sol in the auction
        //require!(auction.liquidity_sol > 0, CustomError::InvalidState);
        //let amount_to_transfer = auction.liquidity_sol; // method 2
        
        // Perform transfer if amount is positive
        if amount_to_transfer > 0 {
            let transfer_instruction = solana_program::system_instruction::transfer(
                &self.auction_sol_account.key,
                &self.admin.key,
                amount_to_transfer,
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
            msg!("Withdrawal successful. Transferred {} lamports to admin.", amount_to_transfer);
        } else {
            msg!("No SOL available to withdraw.");
        }

        auction.is_sol_withdrawn = true;
        Ok(())
    }
}

