// (c) MaxiMeme 2025 / all rights reserved / dev'd by Little Rabbit & Harry
//
// SOL transfer utilities wrapping system_instruction::transfer
// sol_transfer_user for simple transfers, sol_transfer_with_signer for PDA-owned accounts
// Abstracts invoke vs invoke_signed complexity, handles all account info conversions

use anchor_lang::{prelude::*, solana_program};
use solana_program::{
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
};

pub fn sol_transfer_with_signer<'info>(
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    signers: &[&[&[u8]]; 1],
    amount: u64,
) -> ProgramResult {
    let ix = solana_program::system_instruction::transfer(source.key, destination.key, amount);
    invoke_signed(&ix, &[source, destination, system_program], signers)
}

pub fn sol_transfer_user<'info>(
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    amount: u64,
) -> ProgramResult {
    let ix = solana_program::system_instruction::transfer(source.key, destination.key, amount);
    invoke(&ix, &[source, destination, system_program])
}
