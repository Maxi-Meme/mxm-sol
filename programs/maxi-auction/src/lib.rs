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

declare_id!("AuYwiNyd1y3cUchTzrFsML5KasUgYWYHvMncxEBCVWhX");

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
        lock_percent: u64,
        delay_in_seconds: u64,
    ) -> Result<()> {
        ctx.accounts.process(
            ctx.bumps.auction_sol_account,
            x_id,
            name,
            symbol,
            uri,
            duration_hours,
            lock_percent,
            delay_in_seconds,
        )
    }

    pub fn place_bid(ctx: Context<PlaceBid>, bid_qty: u64, x_id: u64) -> Result<()> {
        ctx.accounts.process(bid_qty, x_id)
    }

    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        ctx.accounts.process()
    }

    pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>) -> Result<()> {
        ctx.accounts.process()
    }

    /// Initiazlize a swap pool
    pub fn raydium_migrate(ctx: Context<RaydiumMigrate>, nonce: u8, open_time: u64) -> Result<()> {
        ctx.accounts.process(nonce, open_time)
    }
}
