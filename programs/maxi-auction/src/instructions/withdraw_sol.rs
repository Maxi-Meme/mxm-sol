use crate::{
    account::Auction, constants::AUCTION_SOL_SEED, errors::CustomError,
    account::GlobalInfo, constants::GLOBAL_INFO_SEED, 
    states::AuctionStatus,
    helper::get_status_and_clearing_price,
};
use anchor_lang::{prelude::*, solana_program, system_program};
use solana_program::{
    //entrypoint::ProgramResult,
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

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawSol<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
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
            auction,
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

        // Calculate total unclaimed refunds
        let mut total_unclaimed_refunds = 0u64;
        for bid in auction.bids.iter() {
            if !bid.is_claimed {
                let paid = bid.bid_qty * bid.bid_sol - bid.bid_fee;
                let exact = bid.bid_qty * clearing_price;
                let owed = paid.saturating_sub(exact);
                total_unclaimed_refunds += owed;
            }
        }

        // Calculate withdrawable amount with rent exemption
        let rent = Rent::get()?;
        let rent_exempt_minimum = rent.minimum_balance(0); // 0 data size for auction_sol_account
        let balance = self.auction_sol_account.lamports();
        let base_withdrawable = balance.saturating_sub(total_unclaimed_refunds);
        let amount_to_transfer = base_withdrawable.saturating_sub(rent_exempt_minimum);
        msg!("auction_sol_account balance: {}", balance);
        msg!("Total unclaimed refunds: {}", total_unclaimed_refunds);
        msg!("Rent exempt minimum: {}", rent_exempt_minimum);
        msg!("Withdrawable amount: {}", amount_to_transfer);

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

