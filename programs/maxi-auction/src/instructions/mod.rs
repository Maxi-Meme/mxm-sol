// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Instruction module aggregator and re-exporter
// Makes all instruction handlers available to lib.rs via single import
// Order doesn't matter but conventionally: init, config, auction lifecycle, admin functions

pub mod initialize;
pub use initialize::*;

pub mod create_auction;
pub use create_auction::*;

pub mod place_bid;
pub use place_bid::*;

pub mod cancel_bid;
pub use cancel_bid::*;

pub mod claim;
pub use claim::*;

pub mod withdraw_sol;
pub use withdraw_sol::*;

pub mod withdraw_tokens;
pub use withdraw_tokens::*;

pub mod finalize;
pub use finalize::*;

pub mod init_auction_bids;
pub use init_auction_bids::*;

// [REF] - Referral system instructions
pub mod set_referral;
pub use set_referral::*;

pub mod clear_referrals;
pub use clear_referrals::*;

//pub mod raydium_migrate;
//pub use raydium_migrate::*;
