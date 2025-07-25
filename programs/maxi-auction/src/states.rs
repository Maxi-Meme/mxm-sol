use anchor_lang::prelude::*;
use core::fmt::Debug;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Pubkey,
    pub default_token_supply: u64,
    pub default_token_decimals: u8,
    pub default_start_price_lamports: u64,
    pub fee_account: Pubkey,
    pub dao_account: Pubkey,
    pub min_total_sol: u64,
    // [REF] - Referral system configuration field
    pub ref_bid_fee_perc_share: u64,     // 0-10000 (0.00% to 100.00%) - referrer's share of bid fees
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
    pub bid_fee: u64,       // 8
}

#[derive(PartialEq, Eq, Debug, Default, AnchorSerialize, AnchorDeserialize, Clone )]
pub enum AuctionStatus {
    #[default]
    Pending,
    Live,
    Succeeded,
    FailedMinNotReached,
    FailedNotFullyAllocated,
    Finalized,
}