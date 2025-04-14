use anchor_lang::prelude::*;

#[event]
pub struct AuctionCreated {
    pub auction_id: u64,
    pub creator: Pubkey,
    pub x_id: u64,
    pub token_mint: Pubkey,
    pub lock_percent: u64,
}

#[event]
pub struct NewBid {
    pub auction_id: u64,
    pub bidder: Pubkey,
    pub x_id: u64,
    pub bid_sol: u64,
    pub bid_qty: u64,
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
