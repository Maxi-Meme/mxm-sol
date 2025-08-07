// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// Initializes dynamically-sized bid storage account for an auction
// Creates Bids PDA with empty vector, automatically resized as bids are placed
// Optional pre-initialization to avoid rent costs during first bid, uses BIDS_SEED + auction_id

use crate::{
    account::{Auction, GlobalInfo, Bids},
    constants::{GLOBAL_INFO_SEED, BIDS_SEED},
    errors::CustomError,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitAuctionBids<'info> {
    #[account(
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        address = global_info.config.admin @ CustomError::Unauthorized
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ CustomError::Unauthorized
    )]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(
        init,
        payer = creator,
        space = 8 + 8 + 4, // Intial size - place_bid will dynamically resize if needed / Discriminator (8) + auction_id (8) + Vec length (4)
        seeds = [BIDS_SEED.as_ref(), auction_data_account.id.to_le_bytes().as_ref()],
        bump
    )]
    pub bids_account: Account<'info, Bids>,

    #[account(address = anchor_lang::system_program::ID)]
    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

impl<'info> InitAuctionBids<'info> {
    pub fn process(&mut self) -> Result<()> {
        self.bids_account.auction_id = self.auction_data_account.id;
        self.bids_account.bids = vec![];
        Ok(())
    }
}