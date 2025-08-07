// (c) MaxiMeme 2025 - moon soon / all rights reserved / by Harry & Little Rabbit
//
// Claims tokens for successful auctions or refunds SOL for failed ones
// Uses uniform clearing price - bidders who bid above clearing get partial SOL refund
// Transfers exact token amount based on bid_qty, marks bid as claimed to prevent double-claiming

use crate::{
    account::{Auction, GlobalInfo, Bids},
    constants::{AUCTION_SOL_SEED, GLOBAL_INFO_SEED, BIDS_SEED},
    errors::CustomError,
    events::Claimed,
    helper::get_status_and_clearing_price,
    states::AuctionStatus,
    processor::sol_transfer_with_signer,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer},
};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub caller: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = caller
    )]
    pub caller_token_account: Account<'info, TokenAccount>,

    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    // Added Bids account to access bids
    #[account(
        mut,
        seeds = [BIDS_SEED.as_ref(), auction_data_account.id.to_le_bytes().as_ref()],
        bump
    )]
    pub bids_account: Account<'info, Bids>,

    /// CHECK: Safe. The SPL token program.
    pub token_program: Program<'info, Token>,

    #[account(address = associated_token::ID)]
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,
}

impl<'info> Claim<'info> {
    pub fn process(&mut self) -> Result<()> {
        let auction = &mut self.auction_data_account;
        let bids = &mut self.bids_account.bids; // Updated to use bids_account.bids
        let auction_id = auction.id;
        let token_decimals = auction.token_decimals;
        let auction_bump = auction.bump;
        let dist_percent = auction.dist_percent;
        let min_total_sol = self.global_info.config.min_total_sol;
        require!(!auction.is_finalized, CustomError::AuctionAlreadyFinalized);

        // Log initial claim information
        msg!("claim - Processing claim for auction ID: {}", auction_id);
        msg!("claim - Caller: {}", self.caller.key());

        // Get and log auction status and clearing price
        let (auction_status, clearing_price_wrapped) = get_status_and_clearing_price(
            auction, bids,
            Clock::get()?.unix_timestamp,
            min_total_sol,
        );
        let clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("claim - Auction status: {:?}", auction_status);
        msg!("claim - Clearing price: {}", clearing_price);

        // Update and log auction finished status
        if Clock::get()?.unix_timestamp >= auction.end_timestamp {
            auction.is_finished = true;
            msg!("claim - Auction marked as finished");
        }

        // Check if auction has finished
        require!(auction.is_finished, CustomError::AuctionNotFinished);

        // Accumulators for totals
        let mut total_sol_to_refund: u64 = 0;
        let mut total_tokens_to_claim: u64 = 0;
        let mut processed_bids: u32 = 0;

        // Process all unclaimed bids for the caller
        for (index, bid) in bids.iter_mut().enumerate() {
            if bid.bidder == self.caller.key() && !bid.is_claimed {
                // Log bid details
                msg!("claim - Processing bid index: {}", index);
                msg!("claim - Bid qty: {}, sol: {}, fee: {}", bid.bid_qty, bid.bid_sol, bid.bid_fee);

                if auction_status == AuctionStatus::Succeeded {
                    if clearing_price == 0 {
                        return err!(CustomError::InvalidClearingPrice);
                    }

                    // Auction succeeded: calc and log sol change
                    let paid = bid
                        .bid_qty
                        .checked_mul(bid.bid_sol)
                        .ok_or(CustomError::Overflow)?
                        .checked_sub(bid.bid_fee)
                        .ok_or(CustomError::Overflow)?;
                    let exact = bid
                        .bid_qty
                        .checked_mul(clearing_price)
                        .ok_or(CustomError::Overflow)?;
                    let owed = paid.saturating_sub(exact);

                        total_sol_to_refund = total_sol_to_refund
                            .checked_add(owed)
                            .ok_or(CustomError::Overflow)?;
                        msg!("claim - Paid: {}, Exact: {}, Owed: {}", paid, exact, owed);

                    // Auction succeeded: calc & log token distribution
                    let claim_token_qty = bid.bid_qty
                        .checked_mul(dist_percent)
                        .ok_or(CustomError::Overflow)?
                        .checked_div(10000)
                        .ok_or(CustomError::Overflow)?
                        .checked_mul(10u64.pow(token_decimals as u32))
                        .ok_or(CustomError::Overflow)?;
                        
                        total_tokens_to_claim = total_tokens_to_claim
                            .checked_add(claim_token_qty)
                            .ok_or(CustomError::Overflow)?;
                        msg!("claim - Claimable tokens for this bid: {}", claim_token_qty);
                } else {
                    // Auction failed: refund sol minus fee
                    let paid = bid
                        .bid_qty
                        .checked_mul(bid.bid_sol)
                        .ok_or(CustomError::Overflow)?
                        .checked_sub(bid.bid_fee)
                        .ok_or(CustomError::Overflow)?;
                    
                        total_sol_to_refund = total_sol_to_refund
                            .checked_add(paid)
                            .ok_or(CustomError::Overflow)?;
                        msg!("claim - Refund for failed auction: {}", paid);
                }

                // Mark bid as claimed and log
                bid.is_claimed = true;
                processed_bids += 1;
                msg!("claim - Bid marked as claimed");
            }
        }

        // Log totals
        msg!("claim - Total SOL to refund: {}", total_sol_to_refund);
        msg!("claim - Total tokens to claim: {}", total_tokens_to_claim);
        msg!("claim - Processed bids: {}", processed_bids);

        // Check if any bids were processed
        if processed_bids == 0 {
            msg!("claim - No unclaimed bids found for caller");
            return err!(CustomError::NoBidFoundForCaller);
        }

        // Transfer SOL refund if applicable
        if total_sol_to_refund > 0 {
            msg!("claim - Transferring SOL refund: {}", total_sol_to_refund);
            sol_transfer_with_signer(
                self.auction_sol_account.to_account_info(),
                self.caller.to_account_info(),
                self.system_program.to_account_info(),
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
                total_sol_to_refund,
            )?;
        }

        // Transfer tokens if auction succeeded
        if auction_status == AuctionStatus::Succeeded && total_tokens_to_claim > 0 {
            msg!("claim - Token balance: {}", self.auction_token_account.amount);
            msg!("claim - Transferring tokens: {}", total_tokens_to_claim);
            let cpi_accounts = SplTransfer {
                from: self.auction_token_account.to_account_info(),
                to: self.caller_token_account.to_account_info(),
                authority: self.auction_sol_account.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    self.token_program.to_account_info(),
                    cpi_accounts,
                    &[&[
                        AUCTION_SOL_SEED.as_ref(),
                        auction_id.to_le_bytes().as_ref(),
                        &[auction_bump],
                    ]],
                ),
                total_tokens_to_claim,
            )?;
        }

        // Emit event
        emit!(Claimed {
            auction_id,
            bidder: self.caller.key(),
            claim_qty: if auction_status == AuctionStatus::Succeeded {
                total_tokens_to_claim
            } else {
                0
            },
        });

        // Update and log auction state
        auction.last_status = auction_status;
        auction.clearing_price = clearing_price_wrapped.unwrap_or(0);
        msg!("claim - Updated auction status: {:?}", auction.last_status);
        msg!("claim - Updated clearing price: {}", auction.clearing_price);

        Ok(())
    }
}