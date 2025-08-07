// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Events emitted for off-chain indexing and monitoring
// AuctionCreated includes token_mint for tracking, NewBid contains full bid details including x_id
// AuctionFilled signals 100% allocation reached, Claimed tracks individual token distributions

use anchor_lang::prelude::*;

#[event]
pub struct AuctionCreated {
    pub auction_id: u64,
    pub creator: Pubkey,
    pub x_id: u64,
    pub token_mint: Pubkey,
    pub dist_percent: u64,
}

#[event]
pub struct NewBid {
    pub auction_id: u64,
    pub bidder: Pubkey,
    pub x_id: u64,
    pub bid_sol: u64, // LAMPORTS
    pub bid_qty: u64, // WHOLE TOKEN UNITS!!!
    pub bid_fee: u64, // LAMPORTS
}

#[event]
pub struct BidCancelled {
    pub auction_id: u64,
    pub bidder: Pubkey,
}

#[event]
pub struct AuctionFilled {
    pub auction_id: u64,
}

#[event]
pub struct Claimed {
    pub auction_id: u64,
    pub bidder: Pubkey,
    pub claim_qty: u64,
}

#[event]
pub struct AuctionMigrated {
    pub auction_id: u64,
}
