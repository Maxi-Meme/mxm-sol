use crate::{
    account::{Auction, GlobalInfo},
    constants::{AUCTION_DATA_SEED, AUCTION_SOL_SEED, GLOBAL_INFO_SEED, METADATA_SEED},
    errors::CustomError,
    events::AuctionCreated,
    states::AuctionStatus,
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    metadata::{self, mpl_token_metadata::types::DataV2, Metadata},
    token::{self, Mint, Token, TokenAccount},
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

    /// CHECK: Signer for PDA
    #[account(
        mut,
        seeds = [AUCTION_SOL_SEED.as_ref(), global_info.auctions_num.to_le_bytes().as_ref()],
        bump
    )]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage for auction data
    #[account(
        init,
        payer = creator,
        space = 8 + size_of::<Auction>(),
        seeds = [AUCTION_DATA_SEED.as_ref(), global_info.auctions_num.to_le_bytes().as_ref()],
        bump
    )]
    pub auction_data_account: Box<Account<'info, Auction>>,

    /// CHECK: Auction's token account
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = auction_sol_account
    )]
    pub auction_token_account: Box<Account<'info, TokenAccount>>,

    sysvar_rent: Sysvar<'info, Rent>,

    #[account(address = system_program::ID)]
    system_program: Program<'info, System>,

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
        x_id: u64,
        _name: String,
        _symbol: String,
        uri: String,
        duration_hours: u64, // actually 1/100 of an hour ~= 36s
        dist_percent: u64,
        delay_in_seconds: u64,
        _buyback_period_days: u64,
    ) -> Result<()> {
        msg!("Calling create_auction...");

        require!(dist_percent >= 100 && dist_percent <= 10000, CustomError::InvalidDistPercent); 

        let global_info = &mut self.global_info;
        let _creator = &mut self.creator;
        let token_mint = &mut self.token_mint;
        let auction_sol_account = &mut self.auction_sol_account;
        let auction_data_account = &mut self.auction_data_account;
        let auction_token_account = &mut self.auction_token_account;
        //let bids_account = &mut self.bids_account;
        let auction_id = global_info.auctions_num;

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

        metadata::create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                self.mpl_token_metadata_program.to_account_info(),
                metadata::CreateMetadataAccountsV3 {
                    metadata: self.token_metadata_account.to_account_info(),
                    mint: token_mint.to_account_info(),
                    mint_authority: auction_sol_account.to_account_info(),
                    payer: _creator.to_account_info(),
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
                name: _name,
                symbol: _symbol,
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

        // method 1 - we're using liquidity movement (overmint) - we need to keep mint authority and revoke it on the last bid

        // method 2 (underfund) - revoke token mint authority 
        /*token::set_authority(
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
        )?;*/

        let clock: Clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        let start_timestamp = current_timestamp + (delay_in_seconds as i64);
        let end_timestamp = start_timestamp + (duration_hours as i64 * 36);

        auction_data_account.id = auction_id;
        auction_data_account.is_finished = false;
        auction_data_account.creator = _creator.key();
        auction_data_account.x_id = x_id;
        auction_data_account.start_timestamp = start_timestamp;
        auction_data_account.end_timestamp = end_timestamp;
        auction_data_account.duration_hours = duration_hours;
        auction_data_account.token_mint = token_mint.key();
        auction_data_account.token_supply = global_info.config.default_token_supply;
        auction_data_account.token_decimals = global_info.config.default_token_decimals;
        
        auction_data_account.bump = auction_bump;
        auction_data_account.delay_in_seconds = delay_in_seconds;
        auction_data_account.start_price = global_info.config.default_start_price_lamports;
        auction_data_account.last_status = if delay_in_seconds > 0 {
            AuctionStatus::Pending
        } else {
            AuctionStatus::Live
        };

        // moveliq: method 1 - distribute in full, mint more tokens (overmint) to achieve target price
        auction_data_account.dist_percent = 10000;

        // moveliq: method 2 - reverse fit sol to move to yield target price, for a given fixed token lock % (1-dist_percent)
        //auction_data_account.dist_percent = dist_percent; 

        auction_data_account.is_sol_withdrawn = false;
        auction_data_account.is_tokens_withdrawn = false;

        // we would only need these if we used method 2 (underfund) for liquidity movement (to make use of the remaining sol in the contract, for buyback and/or DAO)
        //auction_data_account.buyback_period_days = buyback_period_days;
        //auction_data_account.is_dao_claimed = false;
        //auction_data_account.buyback_price = 0;

        global_info.auctions_num = auction_id + 1;

        msg!("Auction ID: {} is created", auction_id);
        
        emit!(AuctionCreated {
            auction_id,
            creator: _creator.key(),
            x_id,
            token_mint: token_mint.key(),
            dist_percent: auction_data_account.dist_percent,
        });

        Ok(())
    }
}