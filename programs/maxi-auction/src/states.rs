use anchor_lang::prelude::*;
use core::fmt::Debug;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Pubkey,
    pub default_token_supply: u64,
    pub default_token_decimals: u8,
    pub default_start_price_sol: u64,
    pub default_lock_percent: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug)]
pub struct Bid {
    // 73
    pub bidder: Pubkey,     // 32
    pub x_id: u64,          // 8
    pub bid_timestamp: i64, // 8
    pub bid_qty: u64,       // 8
    pub bid_sol: u64,       // 8
    pub is_claimed: bool,   // 1
}

#[derive(PartialEq, Eq, Debug)]
pub enum AuctionStatus {
    Pending,
    Live,
    Expired,
    ClosedFullyAllocated,
}
