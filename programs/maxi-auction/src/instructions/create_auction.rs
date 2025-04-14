use crate::{
    account::{Auction, GlobalInfo},
    constants::{AUCTION_DATA_SEED, AUCTION_SOL_SEED, GLOBAL_INFO_SEED, MAX_BIDS, METADATA_SEED},
    events::AuctionCreated,
    states::Bid,
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    metadata::{self, mpl_token_metadata::types::DataV2, Metadata},
    token::{self, spl_token::instruction::AuthorityType, Mint, Token, TokenAccount},
};
use core::mem::size_of;

#[derive(Accounts)]
pub struct CreateAuction<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_INFO_SEED.as_ref()],
        bump,
    )]
    pub global_info: Box<Account<'info, GlobalInfo>>,

    // The auction creator
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        address = global_info.config.admin
    )]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = creator,
        mint::decimals = global_info.config.default_token_decimals,
        mint::authority = auction_sol_account.key(),
    )]
    pub token_mint: Box<Account<'info, Mint>>,

    /// CHECK: passed to token metadata program
    #[account(
        mut,
        seeds = [
            METADATA_SEED,
            metadata::ID.as_ref(),
            token_mint.key().as_ref(),
        ],
        bump,
        seeds::program = metadata::ID
    )]
    token_metadata_account: UncheckedAccount<'info>,

    /// CHECK: Signer for PDA - used as authority for the auction token account
    #[account(
        //init_if_needed,
        //payer = creator,
        //space = 8,
        mut,
        seeds = [AUCTION_SOL_SEED.as_ref(), global_info.auctions_num.to_le_bytes().as_ref()],
        bump
    )]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(
        init,
        payer = creator,
        space = 8 + size_of::<Auction>() + (MAX_BIDS * size_of::<Bid>()),
        seeds = [AUCTION_DATA_SEED.as_ref(), global_info.auctions_num.to_le_bytes().as_ref()],
        bump
    )]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// CHECK: The auction's token account (PDA) that will hold the auctioned tokens
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = auction_sol_account
    )]
    pub auction_token_account: Box<Account<'info, TokenAccount>>,

    #[account(address = system_program::ID)]
    system_program: Program<'info, System>,

    sysvar_rent: Sysvar<'info, Rent>,

    #[account(address = token::ID)]
    token_program: Program<'info, Token>,

    #[account(address = associated_token::ID)]
    associated_token_program: Program<'info, AssociatedToken>,

    #[account(address = metadata::ID)]
    mpl_token_metadata_program: Program<'info, Metadata>,
}

impl<'info> CreateAuction<'info> {
    pub fn process(
        &mut self,
        auction_bump: u8,
        // --------------- X id ------------------- //
        x_id: u64,
        // --------------- metadata --------------- //
        name: String,
        symbol: String,
        uri: String,
        // --------------- auction config --------------- //
        duration_hours: u64,
        lock_percent: u64,
        delay_in_seconds: u64,
        //start_price: u64,
    ) -> Result<()> {
        msg!("Calling create_auction...");

        let global_info = &mut self.global_info;
        let creator = &mut self.creator;
        let token_mint = &mut self.token_mint;
        let auction_sol_account = &mut self.auction_sol_account;
        let auction_data_account = &mut self.auction_data_account;
        let auction_token_account = &mut self.auction_token_account;
        let auction_id = global_info.auctions_num;

        // mint tokens
        token::mint_to(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                token::MintTo {
                    mint: token_mint.to_account_info(),
                    to: auction_token_account.to_account_info(),
                    authority: auction_sol_account.to_account_info(),
                },
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
            ),
            global_info.config.default_token_supply,
        )?;

        // create metadata
        metadata::create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                self.mpl_token_metadata_program.to_account_info(),
                metadata::CreateMetadataAccountsV3 {
                    metadata: self.token_metadata_account.to_account_info(),
                    mint: token_mint.to_account_info(),
                    mint_authority: auction_sol_account.to_account_info(),
                    payer: creator.to_account_info(),
                    update_authority: auction_sol_account.to_account_info(),
                    system_program: self.system_program.to_account_info(),
                    rent: self.sysvar_rent.to_account_info(),
                },
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
            ),
            DataV2 {
                name,
                symbol,
                uri: uri.clone(),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            false,
            true,
            None,
        )?;

        //  revoke mint authority
        token::set_authority(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                token::SetAuthority {
                    current_authority: auction_sol_account.to_account_info(),
                    account_or_mint: token_mint.to_account_info(),
                },
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        // Current time
        let clock: Clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        let start_timestamp = current_timestamp + (delay_in_seconds as i64);
        let end_timestamp = start_timestamp + (duration_hours as i64 * 36);

        // Transfer SPL tokens from user to the auction token account
        msg!("sending token to {}", self.auction_token_account.key());

        auction_data_account.id = auction_id;
        auction_data_account.is_finished = false;
        auction_data_account.creator = creator.key();
        auction_data_account.x_id = x_id;
        auction_data_account.start_timestamp = start_timestamp;
        auction_data_account.end_timestamp = end_timestamp;
        auction_data_account.duration_hours = duration_hours;
        auction_data_account.token_mint = token_mint.key();
        auction_data_account.token_supply = global_info.config.default_token_supply;
        auction_data_account.token_decimals = global_info.config.default_token_decimals;
        auction_data_account.lock_percent = lock_percent; //lock_percent.unwrap_or(global_info.config.default_lock_percent);
        auction_data_account.bids = vec![];
        auction_data_account.bump = auction_bump;
        auction_data_account.is_locked = false;
        auction_data_account.delay_in_seconds = delay_in_seconds;
        auction_data_account.start_price = global_info.config.default_start_price_sol;

        global_info.auctions_num = auction_id + 1;

        msg!("Auction id: {} is created", auction_id);

        emit!(AuctionCreated {
            auction_id,
            creator: creator.key(),
            x_id,
            token_mint: token_mint.key(),
            lock_percent: auction_data_account.lock_percent,
        });

        Ok(())
    }
}
