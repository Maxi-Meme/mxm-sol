use crate::states::{Bid, Config};
use anchor_lang::prelude::*;

/// Global state for the auction system.
#[account]
pub struct GlobalInfo {
    pub deployer: Pubkey,
    pub auctions_num: u64,
    pub config: Config, // Reuse the Config struct for common configuration fields.
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
    pub lock_percent: u64,    // 8
    pub is_locked: bool,      // 1
    pub bump: u8,             // 1
    pub delay_in_seconds: u64, // 8
    pub bids: Vec<Bid>,       // 73 * max_bid
    pub start_price: u64,     // 8
}
