//use anchor_lang::prelude::*;
use crate::account::Auction;
use crate::states::AuctionStatus;
//use crate::errors::CustomError;

pub(crate) fn get_remaining_tokens(auction: &Auction) -> u64 { // integer token units (not lamports
    let token_qty = auction
        .token_supply // token lamports
    //.saturating_mul(1000 - auction.lock_percent as u64))
      .saturating_div(10u64.pow(auction.token_decimals as u32));

    let allocated: u64 = auction.bids.iter().map(|b| b.bid_qty).sum();
    token_qty.saturating_sub(allocated)
}

pub(crate) fn get_current_price(
    auction: &Auction,
    current_time: i64,
    default_start_price_lamports: u64,
) -> Option<u64> {
    // linear decay from start_price_sol at start_timestamp to 1 lamport at end_timestamp
    if current_time <= auction.start_timestamp {
        return Some(default_start_price_lamports);
    }
    if current_time >= auction.end_timestamp {
        return Some(1); // Minimum price of 1 lamport
    }

    let start_time = auction.start_timestamp;
    let start_price = default_start_price_lamports;

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

pub(crate) fn get_status_and_clearing_price(
    auction: &Auction,
    current_time: i64,
    min_total_sol: u64,
) -> (AuctionStatus, Option<u64>) {
    
    // get total allocated (bid) tokens and sol
    let allocated_qty_opt: Option<u64> = auction.bids.iter().try_fold(0u64, |acc, b| acc.checked_add(b.bid_qty)); // = auction.bids.iter().map(|b| b.bid_qty).sum();
    let total_sol_opt: Option<u64> = auction.bids.iter().try_fold(0u64, |acc, b| { // = auction.bids.iter().map(|b| (b.bid_qty * b.bid_sol - b.bid_fee)).sum();
        b.bid_qty
            .checked_mul(b.bid_sol)
            .and_then(|product| product.checked_sub(b.bid_fee))
            .and_then(|net| acc.checked_add(net))
    });
    let allocated_qty = allocated_qty_opt.unwrap_or(0);
    let total_sol = total_sol_opt.unwrap_or(0);

    // Determine the auction status
    let supply_qty = auction.token_supply.saturating_div(10u64.pow(auction.token_decimals as u32));
    /*msg!("get_status_and_clearing_price - allocated_qty: {}", allocated_qty);
    msg!("get_status_and_clearing_price - supply_qty: {}", supply_qty);
    msg!("get_status_and_clearing_price - total_sol: {}", total_sol); 
    msg!("get_status_and_clearing_price - min_total_sol: {}", min_total_sol);*/
    let status = if allocated_qty >= supply_qty && total_sol >= min_total_sol { // fully allocated, and min total sol reached
        AuctionStatus::Succeeded
    } else if allocated_qty >= supply_qty && total_sol < min_total_sol { // fully allocated, but min total sol not reached
        AuctionStatus::FailedMinNotReached
    }
    else if current_time < auction.start_timestamp {
        AuctionStatus::Pending
    } else if current_time < auction.end_timestamp {
        AuctionStatus::Live
    } else {
        AuctionStatus::FailedNotFullyAllocated
    };

    // Calculate the clearing price based on the status
    let clearing_price = match status {
        AuctionStatus::Pending => {
            None // Auction hasn't started, no clearing price
        }
        AuctionStatus::Live => {
            if auction.bids.is_empty() {
                None // No bids yet, no clearing price
            } else { // ...
                let last_bid = auction.bids.last().unwrap();
                Some(last_bid.bid_sol)
            }
        }
        AuctionStatus::Succeeded => {
            let mut cumulative_qty = 0u64;
            for bid in &auction.bids {
                cumulative_qty += bid.bid_qty.saturating_mul(10u64.pow(auction.token_decimals as u32));
                if cumulative_qty == auction.token_supply { // Happy path: bids are exact match for token supply
                    
                    return (status, Some(bid.bid_sol)); 
                }
                if cumulative_qty > auction.token_supply {
                    return (status, None); // Shouldn't happen if bids are managed correctly, indicate error
                }
            }
            None // No exact match found
        }
        AuctionStatus::FailedMinNotReached => {
            None 
        }
        AuctionStatus::FailedNotFullyAllocated => {
            None 
        }
    };

    (status, clearing_price)
}

/*pub(crate) fn get_auction_status(auction: &Auction, current_time: i64) -> AuctionStatus {
    let token_qty = auction
        .token_supply
        //.saturating_mul(1000 - auction.lock_percent as u64))
        //.saturating_div(1000 * 10u64.pow(auction.token_decimals as u32)
        ;

    let allocated: u64 = auction.bids.iter().map(|b| b.bid_qty).sum();
    if allocated >= token_qty { // && minsol reached
        AuctionStatus::Succeeded 
    } else if current_time < auction.start_timestamp {
        AuctionStatus::Pending
    } else if current_time < auction.end_timestamp {
        AuctionStatus::Live
    } else {
        AuctionStatus::Failed
    }
}

pub(crate) fn get_auction_clearing_price(auction: &Auction) -> Option<u64> {
    let status = get_auction_status(auction, Clock::get().unwrap().unix_timestamp);
    match status {
        AuctionStatus::Pending => {
            None // Auction hasn't started yet, no clearing price
        }
        AuctionStatus::Live => {
            // TODO: change to weighted avg...
            // clearing price = the last (lowest) bid in final order
            // Bids are stored oldest first = highest first (?), we must confirm:
            // The spec says: "oldest (highest) first" - so the last in the vector is the lowest
            if auction.bids.is_empty() {
                return None;
            }
            let last_bid = auction.bids.last().unwrap();
            Some(last_bid.bid_sol)
        }
        AuctionStatus::Succeeded => {
            let token_qty = auction
                .token_supply
                //.saturating_mul(1000 - auction.lock_percent as u64))
                //.saturating_div(1000 * 10u64.pow(auction.token_decimals as u32)
                ;

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
        AuctionStatus::Failed => {
            return None;
        }
    }
}*/
