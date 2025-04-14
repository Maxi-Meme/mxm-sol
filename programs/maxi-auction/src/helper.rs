use anchor_lang::prelude::*;

use crate::account::Auction;
use crate::states::AuctionStatus;

pub(crate) fn get_remaining_tokens(auction: &Auction) -> u64 {
    let token_qty = (auction
        .token_supply
        .saturating_mul(1000 - auction.lock_percent as u64))
    .saturating_div(1000 * 10u64.pow(auction.token_decimals as u32));

    let allocated: u64 = auction.bids.iter().map(|b| b.bid_qty).sum();
    token_qty.saturating_sub(allocated)
}

pub(crate) fn get_current_price(
    auction: &Auction,
    current_time: i64,
    default_start_price_sol: u64,
) -> Option<u64> {
    // linear decay from start_price_sol at start_timestamp to 1 lamport at end_timestamp
    if current_time <= auction.start_timestamp {
        return Some(default_start_price_sol);
    }
    if current_time >= auction.end_timestamp {
        return Some(1); // Minimum price of 1 lamport
    }

    let start_time = auction.start_timestamp;
    let start_price = default_start_price_sol;

    let total_duration = (auction.end_timestamp - start_time) as u64;
    if total_duration == 0 {
        // degenerate case
        return Some(1);
    }

    let elapsed = (current_time - start_time) as u64;

    // linear interpolation:
    // price(t) = start_price - ( (start_price - end_price) * (elapsed / total_duration) )
    let price_diff = start_price.saturating_sub(1);
    let decay_amount = (price_diff as u128 * elapsed as u128) / (total_duration as u128);
    Some(start_price.saturating_sub(decay_amount as u64))
}

pub(crate) fn get_auction_status(auction: &Auction, current_time: i64) -> AuctionStatus {
    let token_qty = (auction
        .token_supply
        .saturating_mul(1000 - auction.lock_percent as u64))
    .saturating_div(1000 * 10u64.pow(auction.token_decimals as u32));
    let allocated: u64 = auction.bids.iter().map(|b| b.bid_qty).sum();
    if allocated >= token_qty {
        AuctionStatus::ClosedFullyAllocated
    } else if current_time < auction.start_timestamp {
        AuctionStatus::Pending
    } else if current_time < auction.end_timestamp {
        AuctionStatus::Live
    } else {
        AuctionStatus::Expired
    }
}

pub(crate) fn get_auction_clearing_price(auction: &Auction) -> Option<u64> {
    let status = get_auction_status(auction, Clock::get().unwrap().unix_timestamp);
    match status {
        AuctionStatus::Pending => {
            None // Auction hasn't started yet, no clearing price
        }
        AuctionStatus::Live => {
            if auction.bids.is_empty() {
                return None;
            }
            let last_bid = auction.bids.last().unwrap();
            Some(last_bid.bid_sol)
        }
        AuctionStatus::ClosedFullyAllocated => {
            let token_qty = (auction
                .token_supply
                .saturating_mul(1000 - auction.lock_percent as u64))
            .saturating_div(1000 * 10u64.pow(auction.token_decimals as u32));
            // clearing price is the last bid that exactly fills the supply
            let mut cummulative_qty = 0u64;
            for bid in &auction.bids {
                cummulative_qty += bid.bid_qty;
                if cummulative_qty == token_qty {
                    return Some(bid.bid_sol);
                }
                if cummulative_qty > token_qty {
                    // Should never happen if placeBid ensures no over-allocation
                    // Just return Some(bid.bid_sol) anyway, or None to indicate error.
                    return None;
                }
            }
            None
        }
        AuctionStatus::Expired => {
            // clearing price = the last (lowest) bid in final order
            // Bids are stored oldest first = highest first (?), we must confirm:
            // The spec says: "oldest (highest) first" - so the last in the vector is the lowest
            if auction.bids.is_empty() {
                return None;
            }
            let last_bid = auction.bids.last().unwrap();
            Some(last_bid.bid_sol)
        }
    }
}
