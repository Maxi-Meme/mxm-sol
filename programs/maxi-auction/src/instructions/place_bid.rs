use crate::{
    account::{Auction, GlobalInfo},
    constants::{GLOBAL_INFO_SEED, MAX_BIDS},
    errors::CustomError,
    events::{AuctionFilled, NewBid},
    helper::{get_current_price, get_remaining_tokens},
    processor::sol_transfer_user,
    states::Bid,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        address = global_info.config.admin
    )]
    pub admin: Signer<'info>,

    // Auction program account holding SOL (the PDA)
    // For simplicity, let's assume the program's ID is the escrow. In real scenario, use a PDA.
    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>, // #### can set so creator pays rent??? -- can create a unit test for this?????

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBid<'info> {
    pub fn process(&mut self, bid_qty: u64, x_id: u64) -> Result<()> {
        msg!("Calling place_bid for auction {}", self.auction_data_account.id);

        let auction = &mut self.auction_data_account;
        let default_start_price_sol = self.global_info.config.default_start_price_sol;

        // Log initial state
        msg!("Initial bids length: {}", auction.bids.len());
        // msg!("auction_data_account balance: {}", self.auction_data_account.lamports());
        // msg!("auction_data_account data size: {}", self.auction_data_account.data_len());

        require!(auction.bids.len() < MAX_BIDS, CustomError::MaxBidsReached);
        require!(bid_qty > 0, CustomError::NotEnoughTokensLeft);

        // ??? [re-entrancy / concurrency guard - effective?]
        require!(!auction.is_locked, CustomError::ReentrancyGuard);
        auction.is_locked = true;

        let clock = Clock::get()?;
        let current_price =
            get_current_price(auction, clock.unix_timestamp, default_start_price_sol)
                .unwrap_or(default_start_price_sol);
        msg!("current_price: {}", current_price);

        let remaining = get_remaining_tokens(auction);
        msg!("bid_qty: {}", bid_qty);
        msg!("remaining: {}", remaining);
        require!(bid_qty <= remaining, CustomError::NotEnoughTokensLeft);

        // Calculate the bid amount
        let raw_amount = bid_qty * current_price;
        msg!("calculated amount (bid_qty * current_price): {}", raw_amount);

        // Minimum amount to cover the rent
        //let rent_exempt_minimum: u64 = 10_000_000; // 0.01 SOL to cover the rent
        let amount = /*if raw_amount < rent_exempt_minimum {
            msg!("Amount too low to cover the rent. Using the minimum amount: {} lamports", rent_exempt_minimum);
            rent_exempt_minimum
        } else {
            raw_amount
        };*/ raw_amount;
        msg!("final amount to transfer: {}", amount);

        // transfer from bidder to auction_sol_account
        msg!("bidder balance before transfer: {}", self.bidder.lamports());
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.auction_sol_account.to_account_info(),
            self.system_program.to_account_info(),
            amount,
        )?;
        msg!("bidder balance after transfer: {}", self.bidder.lamports());

        // save & emit the bid
        auction.bids.push(Bid {
            bidder: self.bidder.key(),
            x_id,
            bid_timestamp: clock.unix_timestamp,
            bid_qty,
            bid_sol: current_price,
            is_claimed: false,
        });
        emit!(NewBid {
            auction_id: auction.id,
            bidder: self.bidder.key(),
            x_id,
            bid_qty,
            bid_sol: current_price,
        });

        // check if auction is finished
        if remaining - bid_qty == 0 {
            auction.is_finished = true;
            emit!(AuctionFilled {
                auction_id: auction.id,
            });
        }

        // ???
        auction.is_locked = false;
        Ok(())
    }
}
