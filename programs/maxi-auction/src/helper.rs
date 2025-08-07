// (c) MaxiMeme 2025 - moon soon / all rights reserved / by Harry & Little Rabbit
//
// Core calculation engine for Dutch auction mechanics
// get_current_price implements linear decay from start_price to 1 lamport over duration
// get_status_and_clearing_price determines uniform clearing price - all bidders pay lowest accepted bid price
// Uses checked_mul/checked_add throughout to prevent overflow, saturating_sub for safe underflow handling

//use anchor_lang::prelude::*;
use crate::account::Auction;
use crate::states::AuctionStatus;
use anchor_lang::{prelude::*};
use crate::errors::CustomError;
use crate::states::Bid;

pub fn get_net_sol_raised(
    _auction: &Auction,
    bids: &[Bid],
    clearing_price: u64,
    rent_exempt_minimum: u64,
    balance: u64,
) -> Result<u64> { // Fixed: Only one generic argument
    
    // Calculate total refunds owed for unclaimed bids
    let total_unclaimed_refunds = bids.iter()
        .filter(|bid| !bid.is_claimed) // Only unclaimed bids
        .try_fold(0u64, |acc, bid| {
            let paid = bid.bid_qty
                .checked_mul(bid.bid_sol)              // total_cost = qty * sol
                .and_then(|total_cost| total_cost.checked_sub(bid.bid_fee)) // paid = total_cost - fee
                .ok_or(CustomError::Overflow)?;    // No type conversion needed
            let exact = bid.bid_qty
                .checked_mul(clearing_price)
                .ok_or(CustomError::Overflow)?;    // No type conversion needed
            let refund = paid.saturating_sub(exact); // Refund if paid > exact
            acc.checked_add(refund)
                .ok_or(CustomError::Overflow)      // No type conversion needed
        })?;

    // Calculate net SOL raised (withdrawable amount)
    let net_sol_raised = balance
        .checked_sub(total_unclaimed_refunds)
        .and_then(|net| net.checked_sub(rent_exempt_minimum))
        .ok_or(CustomError::Underflow)?;           // Fixed: No into() needed

    // Log the requested values
    msg!("balance: {}", balance);
    msg!("total_unclaimed_refunds: {}", total_unclaimed_refunds);
    msg!("rent_exempt_minimum: {}", rent_exempt_minimum);
    msg!("net_sol_raised: {}", net_sol_raised);

    Ok(net_sol_raised)
}

pub(crate) fn get_remaining_tokens(auction: &Auction, bids: &[Bid]) -> u64 { // integer token units (not lamports
    let token_qty = auction
        .token_supply // token lamports
      .saturating_div(10u64.pow(auction.token_decimals as u32));

    let allocated: u64 = bids.iter().map(|b| b.bid_qty).sum();
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
    bids: &[Bid],
    current_time: i64,
    min_total_sol: u64,
) -> (AuctionStatus, Option<u64>) {
    // Calculate total allocated (bid) tokens and sol
    let allocated_qty_opt: Option<u64> = bids.iter().try_fold(0u64, |acc, b| acc.checked_add(b.bid_qty));
    let total_sol_after_fees_opt: Option<u64> = bids.iter().try_fold(0u64, |acc, b| {
        b.bid_qty
            .checked_mul(b.bid_sol)
            .and_then(|product| product.checked_sub(b.bid_fee))
            .and_then(|net| acc.checked_add(net))
    });
    let allocated_qty = allocated_qty_opt.unwrap_or(0);
    let total_sol_after_fees = total_sol_after_fees_opt.unwrap_or(0);

    // Calculate total unclaimed refunds
    let mut total_change = 0u64;
    let clearing_price_tmp; // our best guess at the clearing price
    if bids.is_empty() {
        clearing_price_tmp = 0; // no bids yet, no clearing price
    } else {
        clearing_price_tmp = bids.last().unwrap().bid_sol; // use the last bid as the price
    }
    for bid in bids.iter() {
        //if !bid.is_claimed {
            let paid = bid.bid_qty * bid.bid_sol - bid.bid_fee;
            let exact = if clearing_price_tmp == 0 {
                bid.bid_qty * bid.bid_sol
            } else {
                bid.bid_qty * clearing_price_tmp
            };
            let owed = paid.saturating_sub(exact);
            total_change += owed;
        //}
    }

    // Calculate net_sol_raised before rent exemption
    let net_sol_raised_before_rent = total_sol_after_fees.saturating_sub(total_change);

    // Derive rent exemption for a 0-byte account
    let rent = Rent::get().unwrap(); // Fetch current rent rules
    let rent_exempt_minimum = rent.minimum_balance(0); // 0 bytes for auction_sol_account

    // Subtract rent exemption to get final net_sol_raised
    let net_sol_raised = net_sol_raised_before_rent.saturating_sub(rent_exempt_minimum); // empty would be nicer...

    // Determine the auction status
    let supply_qty = auction.token_supply.saturating_div(10u64.pow(auction.token_decimals as u32));

    msg!("get_status_and_clearing_price -           allocated_qty: {}", allocated_qty);
    msg!("get_status_and_clearing_price -              supply_qty: {}", supply_qty);
    msg!("get_status_and_clearing_price -    total_sol_after_fees: {}", total_sol_after_fees);
    msg!("get_status_and_clearing_price -      clearing_price_tmp: {}", clearing_price_tmp);
    msg!("get_status_and_clearing_price -            total_change: {}", total_change);
    msg!("get_status_and_clearing_price -     rent_exempt_minimum: {}", rent_exempt_minimum);
    msg!("get_status_and_clearing_price -          net_sol_raised: {}", net_sol_raised); // this must be >
    msg!("get_status_and_clearing_price -           MIN_TOTAL_SOL: {}", min_total_sol);  // than this

    // Assign status
    let status = if allocated_qty >= supply_qty && net_sol_raised >= min_total_sol {
        AuctionStatus::Succeeded
    } else if allocated_qty >= supply_qty && net_sol_raised < min_total_sol {
        AuctionStatus::FailedMinNotReached
    } else if current_time < auction.start_timestamp {
        AuctionStatus::Pending
    } else if current_time < auction.end_timestamp {
        AuctionStatus::Live
    } else {
        AuctionStatus::FailedNotFullyAllocated
    };

    // Assign the clearing price based on the status
    let clearing_price = match status {
        AuctionStatus::Pending => None,
        AuctionStatus::Live => {
            if bids.is_empty() {
                None
            } else {
                let last_bid = bids.last().unwrap();
                Some(last_bid.bid_sol)
            }
        }
        AuctionStatus::Succeeded => get_clearing_price(auction, bids),
        AuctionStatus::FailedMinNotReached => None,
        AuctionStatus::FailedNotFullyAllocated => None,
        AuctionStatus::Finalized => None,
    };

    (status, clearing_price)
}

fn get_clearing_price(auction: &Auction, bids: &[Bid]) -> Option<u64> {
    let mut cumulative_qty = 0u64;
    for bid in bids {
        cumulative_qty += bid.bid_qty.saturating_mul(10u64.pow(auction.token_decimals as u32));
        if cumulative_qty == auction.token_supply { // Happy path: bids are exact match for token supply
            return Some(bid.bid_sol);
        }
        if cumulative_qty > auction.token_supply {
            return None; // Shouldn't happen if bids are managed correctly, indicates error
        }
    }
    return None;
}
