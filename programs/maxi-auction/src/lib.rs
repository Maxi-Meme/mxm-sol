use anchor_lang::prelude::*;

pub mod account;
pub mod constants;
pub mod errors;
pub mod events;
pub mod helper;
pub mod instructions;
pub mod processor;
pub mod states;

use instructions::*;
use states::Config;
use errors::CustomError;

declare_id!("3UGQHeMjgnGn5wCnekaVZNEEp5j1oVt1dj5q7dTiw8ZF");

#[program]
pub mod maxi_auction {

    use super::*;

    pub fn initialize<'info>(
        ctx: Context<'_, '_, '_, 'info, Initialize<'info>>,
        new_config: Config,
    ) -> Result<()> {
        ctx.accounts.process(new_config)
    }

    pub fn set_config(ctx: Context<SetConfig>, new_config: Config) -> Result<()> {
        ctx.accounts.process(new_config)
    }

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        x_id: u64,
        name: String,
        symbol: String,
        uri: String,
        duration_hours: u64,
        dist_percent: u64,
        delay_in_seconds: u64,
        buyback_period_days: u64,
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.auction_sol_account,
            x_id,
            name,
            symbol,
            uri,
            duration_hours,
            dist_percent,
            delay_in_seconds,   
            buyback_period_days,
        )
    }

    pub fn place_bid<'info>(ctx: Context<'_, '_, '_, 'info, PlaceBid<'info>>, bid_qty: u64, x_id: u64, fee_perc: u64) -> Result<()> {
        let num_fee_accounts = ctx.accounts.global_info.config.fee_accounts.len();
        let remaining = ctx.remaining_accounts;
        require!(
            remaining.len() >= num_fee_accounts,
            CustomError::InvalidAccountInput
        );
        ctx.accounts.process(bid_qty, x_id, fee_perc, remaining)
    }

    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn init_auction_bids(ctx: Context<InitAuctionBids>) -> Result<()> {
        ctx.accounts.process()
    }

    // [REF] - Admin-only function to set referral mappings
    pub fn set_referral(ctx: Context<SetReferral>, referred_account: Pubkey, referrer_account: Pubkey) -> Result<()> {
        ctx.accounts.process(referred_account, referrer_account)
    }
}
