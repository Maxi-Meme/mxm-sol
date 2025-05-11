use crate::{
    account::{Auction, GlobalInfo},
    constants::{GLOBAL_INFO_SEED, MAX_BIDS},
    errors::CustomError,
    events::{AuctionFilled, NewBid},
    helper::{get_current_price, get_remaining_tokens},
    helper::{get_status_and_clearing_price},
    processor::sol_transfer_user,
    states::Bid,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::rent::Rent;

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

    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// CHECK: Revenue account to receive the 1% fee
    #[account(
        mut,
        address = global_info.config.fee_account
    )]
    pub fee_account: AccountInfo<'info>,    

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> PlaceBid<'info> {
    pub fn process(&mut self, bid_quantity: u64, x_id: u64) -> Result<()> {
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(0);

        let auction = &mut self.auction_data_account;
        let default_start_price = self.global_info.config.default_start_price_lamports;
        require!(!auction.is_admin_aborted, CustomError::AuctionAdminAborted);
        
        // Validate bid and auction state
        require!(auction.bids.len() < MAX_BIDS, CustomError::MaxBidsReached);
        require!(bid_quantity > 0, CustomError::InvalidBidQuantity);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= auction.start_timestamp, CustomError::AuctionNotStarted);
        require!(!auction.is_finished, CustomError::AuctionEnded);
        require!(
            !(auction.bids.len() > 0 && self.auction_sol_account.lamports() == 0),
            CustomError::AuctionLiquidityMoved
        );

        // Calculate current price and remaining tokens
        let mut current_price = get_current_price(auction, clock.unix_timestamp, default_start_price)
            .unwrap_or(default_start_price);
        let remaining_tokens = get_remaining_tokens(auction);
        require!(bid_quantity <= remaining_tokens, CustomError::NotEnoughTokensLeft);

        // Calculate initial total cost
        let mut total_cost = bid_quantity.checked_mul(current_price).ok_or(CustomError::Overflow)?;
        let mut fee = total_cost / 100; // 1% fee, integer division
        let mut auction_amount = total_cost - fee;

        // Adjust total_cost if auction_amount is below min_rent
        if auction_amount < min_rent {
            // All hail Grok
            let mut low = total_cost;
            let mut high = u64::MAX;
            while low < high {
                let mid = low + (high - low) / 2;
                let f = mid / 100;
                let a = mid - f;
                if a >= min_rent {
                    high = mid;
                } else {
                    low = mid + 1;
                }
            }
            total_cost = low;
            msg!("bumping total_cost to {} to cover min rent", total_cost);
            
            // Calculate adjusted current_price (ceiling division)
            current_price = (total_cost + bid_quantity - 1) / bid_quantity;

            // Recalculate total_cost, fee, and auction_amount with adjusted current_price
            total_cost = bid_quantity.checked_mul(current_price).ok_or(CustomError::Overflow)?;
            fee = total_cost / 100;
            auction_amount = total_cost - fee;
        }

        // Log the values for debugging
        msg!("bid_quantity: {}", bid_quantity);
        msg!("current_price: {}", current_price);
        msg!("remaining_tokens: {}", remaining_tokens);
        msg!("total_cost: {}", total_cost);
        msg!("auction_amount: {}", auction_amount);
        msg!("fee: {}", fee);
        msg!("min_rent: {}", min_rent);

        // Transfer auction amount to auction_sol_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.auction_sol_account.to_account_info(),
            self.system_program.to_account_info(),
            auction_amount,
        )?;

        // Transfer fee to fee_account
        sol_transfer_user(
            self.bidder.to_account_info(),
            self.fee_account.to_account_info(),
            self.system_program.to_account_info(),
            fee,
        )?;

        // Record the bid with adjusted current_price and fee
        auction.bids.push(Bid {
            bidder: self.bidder.key(),
            x_id,
            bid_timestamp: clock.unix_timestamp,
            bid_qty: bid_quantity,
            bid_sol: current_price,
            is_claimed: false,
            bid_fee: fee,
        });

        // Emit bid event
        emit!(NewBid {
            auction_id: auction.id,
            bidder: self.bidder.key(),
            x_id,
            bid_qty: bid_quantity,
            bid_sol: current_price,
            bid_fee: fee,
        });

        // Check if auction is fully allocated
        if remaining_tokens - bid_quantity == 0 {
            auction.is_finished = true;
            emit!(AuctionFilled {
                auction_id: auction.id,
            });
        }

        // Update status & clearing price
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
            auction,
            clock.unix_timestamp,
            self.global_info.config.min_total_sol
        );
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("updated auction_status: {:?}", auction.last_status);

        Ok(())
    }
}

