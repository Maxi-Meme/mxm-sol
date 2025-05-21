use crate::states::{Bid, Config, AuctionStatus};
use anchor_lang::prelude::*;

/// Global state for the auction system.
#[account]
pub struct GlobalInfo {
    pub deployer: Pubkey,
    pub auctions_num: u64,
    pub config: Config,
}

/// Account to store bids for an auction.
#[account]
pub struct Bids {
    pub auction_id: u64, // Links this account to a specific auction
    pub bids: Vec<Bid>,  // Vector to store bids, allowing dynamic growth
}

#[account]
#[derive(Default)]
pub struct Auction {
    pub id: u64,              // 8
    pub is_finished: bool,    // 1
    pub creator: Pubkey,      // 32
    pub x_id: u64,            // 8
    pub start_timestamp: i64, // 8
    pub end_timestamp: i64,   // 8
    pub duration_hours: u64,  // 8
    pub token_mint: Pubkey,   // 32
    pub token_supply: u64,    // 8
    pub token_decimals: u8,   // 1
    pub dist_percent: u64,    // 8: 10000 = 100%
    pub bump: u8,             // 1
    pub delay_in_seconds: u64,// 8
    pub start_price: u64,     // 8
    pub clearing_price: u64,  // 8
    pub last_status: AuctionStatus, // 1
    pub is_sol_withdrawn: bool, // 1
    pub is_tokens_withdrawn: bool, // 1
    pub is_finalized: bool,   // 1
    pub liquidity_overmint: u64, // 8
    pub net_sol_raised: u64,  // 8
    pub liquidity_sol: u64,   // 8
    pub buyback_price: u64,   // 8
    pub buyback_period_days: u64, // 2
    pub is_dao_claimed: bool, // 1
}