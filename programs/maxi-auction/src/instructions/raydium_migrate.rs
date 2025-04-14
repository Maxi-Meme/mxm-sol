use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, spl_token, Token, TokenAccount, Transfer as SplTransfer};
use raydium_amm_cpi::Initialize2;

use crate::account::Auction;
use crate::constants::AUCTION_SOL_SEED;
use crate::processor::sol_transfer_with_signer;

#[derive(Accounts, Clone)]
pub struct RaydiumMigrate<'info> {
    /// CHECK: no checks needed, just program's account
    #[account(mut)]
    pub auction_sol_account: AccountInfo<'info>,

    /// CHECK: Storage - used as storage for the auction data
    #[account(mut)]
    pub auction_data_account: Box<Account<'info, Auction>>,

    #[account(mut)]
    pub auction_token_account: Account<'info, TokenAccount>,

    /// CHECK: Safe
    pub amm_program: UncheckedAccount<'info>,
    /// CHECK: Safe. The new amm Account to be create, a PDA create with seed = [program_id, openbook_market_id, b"amm_associated_seed"]
    #[account(mut)]
    pub amm: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm authority, a PDA create with seed = [b"amm authority"]
    #[account()]
    pub amm_authority: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm open_orders Account, a PDA create with seed = [program_id, openbook_market_id, b"open_order_associated_seed"]
    #[account(mut)]
    pub amm_open_orders: UncheckedAccount<'info>,
    /// CHECK: Safe. Pool lp mint account. Must be empty, owned by $authority.
    #[account(mut)]
    pub amm_lp_mint: UncheckedAccount<'info>,
    /// CHECK: Safe. Coin mint account
    #[account(
        owner = token_program.key()
    )]
    pub amm_coin_mint: UncheckedAccount<'info>,
    /// CHECK: Safe. Pc mint account
    #[account(
        owner = token_program.key()
    )]
    pub amm_pc_mint: UncheckedAccount<'info>,
    /// CHECK: Safe. amm_coin_vault Account. Must be non zero, owned by $authority
    #[account(mut)]
    pub amm_coin_vault: UncheckedAccount<'info>,
    /// CHECK: Safe. amm_pc_vault Account. Must be non zero, owned by $authority.
    #[account(mut)]
    pub amm_pc_vault: UncheckedAccount<'info>,
    /// CHECK: Safe. amm_target_orders Account. Must be non zero, owned by $authority.
    #[account(mut)]
    pub amm_target_orders: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm Config.
    #[account()]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm create_fee_destination.
    #[account(mut)]
    pub create_fee_destination: UncheckedAccount<'info>,
    /// CHECK: Safe. OpenBook program.
    #[account(
        address = raydium_amm_cpi::openbook_program_id::id(),
    )]
    pub market_program: UncheckedAccount<'info>,
    /// CHECK: Safe. OpenBook market. OpenBook program is the owner.
    #[account(
        owner = market_program.key(),
    )]
    pub market: UncheckedAccount<'info>,
    /// CHECK: Safe. The user wallet create the pool
    #[account(mut)]
    pub user_wallet: Signer<'info>,
    /// CHECK: Safe. The user coin token
    #[account(
        mut,
        // owner = token_program.key(),
    )]
    pub user_token_coin: UncheckedAccount<'info>,
    /// CHECK: Safe. The user pc token
    #[account(
        mut,
        // owner = token_program.key(),
    )]
    pub user_token_pc: UncheckedAccount<'info>,
    /// CHECK: Safe. The user lp token
    #[account(mut)]
    pub user_token_lp: UncheckedAccount<'info>,
    /// CHECK: Safe. The spl token program
    pub token_program: Program<'info, Token>,
    /// CHECK: Safe. The associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: Safe. System program
    pub system_program: Program<'info, System>,
    /// CHECK: Safe. Rent program
    pub sysvar_rent: Sysvar<'info, Rent>,
}

impl<'a, 'b, 'c, 'info> From<&mut RaydiumMigrate<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Initialize2<'info>>
{
    fn from(
        accounts: &mut RaydiumMigrate<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, Initialize2<'info>> {
        let cpi_accounts = Initialize2 {
            amm: accounts.amm.clone(),
            amm_authority: accounts.amm_authority.clone(),
            amm_open_orders: accounts.amm_open_orders.clone(),
            amm_lp_mint: accounts.amm_lp_mint.clone(),
            amm_coin_mint: accounts.amm_coin_mint.clone(),
            amm_pc_mint: accounts.amm_pc_mint.clone(),
            amm_coin_vault: accounts.amm_coin_vault.clone(),
            amm_pc_vault: accounts.amm_pc_vault.clone(),
            amm_target_orders: accounts.amm_target_orders.clone(),
            amm_config: accounts.amm_config.clone(),
            create_fee_destination: accounts.create_fee_destination.clone(),
            market_program: accounts.market_program.clone(),
            market: accounts.market.clone(),
            user_wallet: accounts.user_wallet.clone(),
            user_token_coin: accounts.user_token_coin.clone(),
            user_token_pc: accounts.user_token_pc.clone(),
            user_token_lp: accounts.user_token_lp.clone(),
            token_program: accounts.token_program.clone(),
            associated_token_program: accounts.associated_token_program.clone(),
            system_program: accounts.system_program.clone(),
            sysvar_rent: accounts.sysvar_rent.clone(),
        };
        let cpi_program = accounts.amm_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

impl<'info> RaydiumMigrate<'info> {
    /// Initiazlize a swap pool
    pub fn process(&mut self, nonce: u8, open_time: u64) -> Result<()> {
        msg!("Processing RaydiumMigrate...");
        let auction = &mut self.auction_data_account;
        let auction_id = auction.id;
        let auction_bump = auction.bump;
        let init_pc_amount = self.auction_sol_account.lamports().into();
        let init_coin_amount = auction
            .token_supply
            .saturating_mul(auction.lock_percent)
            .saturating_div(1000);
        let _ = sol_transfer_with_signer(
            self.auction_sol_account.to_account_info(),
            self.user_token_pc.to_account_info(),
            self.system_program.to_account_info(),
            &[&[
                AUCTION_SOL_SEED.as_ref(),
                auction_id.to_le_bytes().as_ref(),
                &[auction_bump],
            ]],
            init_pc_amount,
        );
        msg!("Sol transfer completed");
        // Sync native tokens to ensure proper balance
        let sync_native_ix = spl_token::instruction::sync_native(
            &self.token_program.key(),
            &self.user_token_pc.key(),
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &sync_native_ix,
            &[
                self.user_token_pc.to_account_info(),
                self.token_program.to_account_info(),
            ],
            &[&[
                AUCTION_SOL_SEED.as_ref(),
                auction_id.to_le_bytes().as_ref(),
                &[auction_bump],
            ]],
        )?;
        msg!("Sync native tokens completed");
        // Token transfer from the token pool to the user wallet
        let transfer_instruction = SplTransfer {
            from: self.auction_token_account.to_account_info(),
            to: self.user_token_coin.to_account_info(),
            authority: self.auction_sol_account.to_account_info(),
        };

        // Execute token transfer
        token::transfer(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                transfer_instruction,
                &[&[
                    AUCTION_SOL_SEED.as_ref(),
                    auction_id.to_le_bytes().as_ref(),
                    &[auction_bump],
                ]],
            ),
            init_coin_amount,
        )?;

        raydium_amm_cpi::initialize(
            self.into(),
            nonce,
            open_time,
            init_pc_amount,
            init_coin_amount,
        )

    }
}
