import * as anchor from "@coral-xyz/anchor";
import { Decimal } from 'decimal.js';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { Raydium, TxVersion, DEVNET_PROGRAM_ID, CLMM_PROGRAM_ID, WSOLMint, AMM_V4, OPEN_BOOK_PROGRAM, FEE_DESTINATION_ID, MARKET_STATE_LAYOUT_V3, TOKEN_WSOL, ApiV3Token, TickUtils }
  from '@raydium-io/raydium-sdk-v2';

import { PoolUtils } from '@raydium-io/raydium-sdk-v2';

import {
  ApiV3PoolInfoConcentratedItem,
  ClmmKeys,
  ComputeClmmPoolInfo,
  ReturnTypeFetchMultiplePoolTickArrays,
} from '@raydium-io/raydium-sdk-v2'

import { getMint, getOrCreateAssociatedTokenAccount, createSyncNativeInstruction, createTransferInstruction } from '@solana/spl-token';
import { Connection, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { MaxiAuction } from "../target/types/maxi_auction";
import "dotenv/config";
import * as sql from "mssql";
import "./logging";

const GLOBAL_INFO_SEED = "global_info_seed";
const AUCTION_SOL_SEED = "auction_sol_seed";
const AUCTION_DATA_SEED = "auction_data_seed";

const DB_CONFIG: sql.config = {
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  pool: {
    max: 20,
    min: 0,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
  }
};

const GIFT_HOLDING_ACCOUNT = new PublicKey("GJcEf3rXCy2vg31bprhGjkau6Wqio9Y899W5jwLYZTac");

// Retry helper function
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3, delayMs: number = 1000): Promise<T> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      if (attempts >= maxRetries) {
        throw error;
      }
      console.log(`Attempt ${attempts} failed, retrying in ${delayMs}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Max retries reached');
}

// Migrate auction liquidity to a new Raydium pool
export const migrateAuction = async (program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, adminKp: Keypair, connection: Connection) => {
  const LIQ_FEE_PERCENT = 69; // 0.69%, 10000 = 100%

  try {
    // Abort if min SOL is not reached - users will claim back their SOL in full
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_DATA_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_SOL_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionDataFetched = await withRetry(() => program.account.auction.fetch(auctionData));
    if (auctionDataFetched.lastStatus?.failedMinNotReached) {
      throw new Error('failedMinNotReached');
    }
    if (auctionDataFetched.clearingPrice.lte(new BN(0))) {
      throw new Error('invalid clearing price');
    }

    const FIXED_MIN_SOL_LIQ = isMainnet
      ? new BN(10.00 * LAMPORTS_PER_SOL)
      : new BN(0.001 * LAMPORTS_PER_SOL);

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_INFO_SEED)], program.programId);
    const globalInfoAccount = await withRetry(() => program.account.globalInfo.fetch(globalInfo));
    const CONFIG_MIN_TOTAL_SOL = globalInfoAccount.config.minTotalSol;

    const FIXED_SOL_RAYDIUM_COSTS = new BN(0.000025 * LAMPORTS_PER_SOL);

    console.log(`MIN_SOL_LIQ`, FIXED_MIN_SOL_LIQ.toString());
    console.log(`CONFIG_MIN_TOTAL_SOL`, CONFIG_MIN_TOTAL_SOL.toString());
    console.log(`FIXED_SOL_RAYDIUM_COSTS`, FIXED_SOL_RAYDIUM_COSTS.toString());
    if (CONFIG_MIN_TOTAL_SOL.lt(FIXED_SOL_RAYDIUM_COSTS.mul(new BN(2)))) {
      console.log(`CONFIG_MIN_TOTAL_SOL is too low: ${CONFIG_MIN_TOTAL_SOL.toString()} < ${FIXED_SOL_RAYDIUM_COSTS.mul(new BN(2)).toString()}`);
      throw new Error('CONFIG_MIN_TOTAL_SOL is too low');
    }

    // Withdraw funds & validate min SOL bid thresholds
    const { solAmount: solWithdrawn, tokenAmount: tokensWithdrawn, tokenMint, adminTokenAccount } = await withRetry(() => withdrawFunds(program, isMainnet, auctionId, adminKp, connection));
    if (solWithdrawn === BigInt(0) || tokensWithdrawn === BigInt(0)) {
      throw new Error("Failed withdrawing funds");
    }
    const mintAccount = await withRetry(() => getMint(connection, tokenMint));
    console.log(`migrateAuction => Withdrawn ${solWithdrawn.toString()} lamports and ${tokensWithdrawn.toString()} tokens`);
    console.log(`solWithdrawn`, solWithdrawn.toString());
    if (new BN(solWithdrawn.toString()).lt(new BN(FIXED_MIN_SOL_LIQ.toString()))) {
      throw new Error('solWithdrawn is too low: MIN_SOL_LIQ');
    }
    if (new BN(solWithdrawn.toString()).lt(new BN(CONFIG_MIN_TOTAL_SOL.toString()))) {
      throw new Error('solWithdrawn is too low: CONFIG_MIN_TOTAL_SOL #### SHOULD NOT HAPPEN! auction state should be failed, and admin withdraw not allowed #####');
    }

    // Get auction gifts total tokens allocated
    const totalGiftTokens = new BN("5000000"); //await getAuctionGifts(auctionId, tokenMint);
    console.log(`totalGiftTokens`, totalGiftTokens.toString());

    // Calculate how much SOL to wrap - keep setup costs in SOL
    var liquidityWSol = new BN(solWithdrawn.toString()).sub(FIXED_SOL_RAYDIUM_COSTS);
    if (liquidityWSol.lte(new BN(0))) throw new Error('liquidityWSol is too low');
    console.log(`liquidityWSol`, liquidityWSol.toString());

    // Wrap admin's withdrawn SOL, less fixed Raydium costs
    const adminWsolAccount = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, adminKp, new PublicKey(TOKEN_WSOL.address), adminKp.publicKey));
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKp.publicKey,
        toPubkey: adminWsolAccount.address,
        lamports: BigInt(liquidityWSol.toString()),
      }),
      createSyncNativeInstruction(adminWsolAccount.address)
    );
    wrapTx.feePayer = adminKp.publicKey;
    wrapTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    const wrapSig = await withRetry(() => sendAndConfirmTransaction(connection, wrapTx, [adminKp]));
    console.log(`${wrapSig} migrateAuction => Wrapped SOL into WSOL`);

    // Calculate how many tokens to deposit into the pool
    var liquidityTokens = new BN(tokensWithdrawn.toString()).mul(new BN(10000)).div(new BN(10001));
    console.log(`tokensWithdrawn`, tokensWithdrawn.toString());
    console.log(`liquidityTokens (sub epsilon; avoid Raydium rounding issues)`, liquidityTokens.toString());

    // Take a fee, both tokens & SOL
    console.log(`LIQ_FEE_PERCENT = ${LIQ_FEE_PERCENT / 100}%`, LIQ_FEE_PERCENT);
    const liqFeeTokens = liquidityTokens.mul(new BN(LIQ_FEE_PERCENT)).div(new BN(10000));
    const liqFeeWSol = liquidityWSol.mul(new BN(LIQ_FEE_PERCENT)).div(new BN(10000));
    console.log(`liqFeeTokens`, liqFeeTokens.toString());
    console.log(`liqFeeWSol`, liqFeeWSol.toString());
    console.log(`liquidityTokens before liq. fees`, liquidityTokens.toString());
    console.log(`liquidityWSol before liq. fees`, liquidityWSol.toString());
    liquidityTokens = liquidityTokens.sub(liqFeeTokens);
    liquidityWSol = liquidityWSol.sub(liqFeeWSol);
    console.log(`liquidityTokens after liq. fees`, liquidityTokens.toString());
    console.log(`liquidityWSol after liq. fees`, liquidityWSol.toString());

    // Reserve auction gifts
    const { giftTokens, giftSol, liquidityTokensAfterGifts, liquidityWSolAfterGifts } = await withRetry(() =>
      reserveAuctionGifts(liquidityTokens, liquidityWSol, totalGiftTokens, tokenMint, adminKp, connection)
    );
    liquidityTokens = liquidityTokensAfterGifts;
    liquidityWSol = liquidityWSolAfterGifts;

    // Create & fund a new market/pool
    const initialBalanceLamports = await withRetry(() => connection.getBalance(adminKp.publicKey));
    console.log(`Initial admin SOL balance: ${initialBalanceLamports / 1e9} SOL`);

    const { poolId, poolKeys } = await withRetry(() => createAndFundPool_v3_CLMM(
      program, isMainnet, auctionId, tokenMint,
      BigInt(liquidityTokens.toString()),
      BigInt(liquidityWSol.toString()),
      adminKp, connection, auctionDataFetched.clearingPrice.toNumber()
    ));

    const finalBalanceLamports = await withRetry(() => connection.getBalance(adminKp.publicKey));
    console.log(`Final admin SOL balance: ${finalBalanceLamports / 1e9} SOL`);
    const costLamports = initialBalanceLamports - finalBalanceLamports;
    const costSOL = costLamports / 1e9;
    console.log(`POOL COST CROSS-CHECK: ${costSOL} SOL`);

    console.log(`migrateAuction => OK!`);
    console.log(`tokenMint: ${tokenMint.toBase58()}`);
    console.log(`liquidityTokens: ${liquidityTokens.toString()}`);
    console.log(`liquidityWSol: ${liquidityWSol.toString()}`);
    console.log(`poolId: ${poolId.toBase58()}`);

    // Update DB keypair with market/pool info
    await withRetry(() => updateKeyPairPoolInfo(tokenMint, null, poolKeys, null, poolId));

    // Send fee tokens to the revenue wallets (based on configured percentages)
    if (liqFeeTokens.gt(new BN(0))) {
      const feeAccounts = globalInfoAccount.config.feeAccounts;
      const numFeeAccounts = feeAccounts.length;
      
      if (numFeeAccounts > 0) {
        let totalTransferred = new BN(0);
        
        for (let i = 0; i < numFeeAccounts; i++) {
          const feeAccountConfig = feeAccounts[i];
          const feeAccountTokenAccount = getAssociatedTokenAddressSync(tokenMint, feeAccountConfig.pubkey, true);
          
          // Calculate amount based on percentage
          // For last account, give any remainder to ensure total equals liqFeeTokens
          const amount = i === numFeeAccounts - 1
            ? liqFeeTokens.sub(totalTransferred)
            : liqFeeTokens.mul(new BN(feeAccountConfig.share)).div(new BN(10000));
          
          if (amount.gt(new BN(0))) {
            const feeTx = new Transaction().add(
              createAssociatedTokenAccountIdempotentInstruction(adminKp.publicKey, feeAccountTokenAccount, feeAccountConfig.pubkey, tokenMint, TOKEN_PROGRAM_ID),
              createTransferInstruction(
                adminTokenAccount,
                feeAccountTokenAccount,
                adminKp.publicKey,
                BigInt(amount.toString()),
                [],
                TOKEN_PROGRAM_ID
              )
            );
            feeTx.feePayer = adminKp.publicKey;
            feeTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
            const feeSig = await withRetry(() => sendAndConfirmTransaction(connection, feeTx, [adminKp]));
            await logSuccessTx(connection, feeSig, `migrateAuction (${auctionId}) => Sent fee ${amount.toNumber() / 10 ** mintAccount.decimals} tokens to fee account ${i+1}/${numFeeAccounts} (${feeAccountConfig.share.toNumber()/100}%)`);
            totalTransferred = totalTransferred.add(amount);
          }
        }
      }
    } else {
      console.log(`no token fees to send.`);
    }
    // Send WSOL fees to the revenue wallets (based on configured percentages)
    if (liqFeeWSol.gt(new BN(0))) {
      const feeAccounts = globalInfoAccount.config.feeAccounts;
      const numFeeAccounts = feeAccounts.length;
      
      if (numFeeAccounts > 0) {
        let totalTransferred = new BN(0);
        
        for (let i = 0; i < numFeeAccounts; i++) {
          const feeAccountConfig = feeAccounts[i];
          const feeAccountWsolATA = getAssociatedTokenAddressSync(new PublicKey(TOKEN_WSOL.address), feeAccountConfig.pubkey, true);
          
          // Calculate amount based on percentage
          // For last account, give any remainder to ensure total equals liqFeeWSol
          const amount = i === numFeeAccounts - 1
            ? liqFeeWSol.sub(totalTransferred)
            : liqFeeWSol.mul(new BN(feeAccountConfig.share)).div(new BN(10000));
          
          if (amount.gt(new BN(0))) {
            const wsolFeeTx = new Transaction().add(
              createAssociatedTokenAccountIdempotentInstruction(
                adminKp.publicKey,
                feeAccountWsolATA,
                feeAccountConfig.pubkey,
                new PublicKey(TOKEN_WSOL.address),
                TOKEN_PROGRAM_ID
              ),
              createTransferInstruction(
                adminWsolAccount.address,
                feeAccountWsolATA,
                adminKp.publicKey,
                BigInt(amount.toString()),
                [],
                TOKEN_PROGRAM_ID
              )
            );
            wsolFeeTx.feePayer = adminKp.publicKey;
            wsolFeeTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
            const wsolFeeSig = await withRetry(() => sendAndConfirmTransaction(connection, wsolFeeTx, [adminKp]));
            await logSuccessTx(connection, wsolFeeSig, `migrateAuction (${auctionId}) => Sent fee ${amount.toNumber() / LAMPORTS_PER_SOL} WSOL to fee account ${i+1}/${numFeeAccounts} (${feeAccountConfig.share.toNumber()/100}%)`);
            totalTransferred = totalTransferred.add(amount);
          }
        }
      }
    } else {
      console.log(`no wsol fees to send.`);
    }

    // Use SOL associated with the gift tokens to buy & burn from the pool
    if (giftSol.gt(new BN(0))) {
      await withRetry(() => buyAndBurn(giftSol, tokenMint, poolId, adminKp, connection, isMainnet));
    }
  } catch (error) {
    console.error(`migrateAuction (${auctionId}) => Error: ${error}`);
    throw error;
  }
};

// Updated getAuctionGifts to fetch sum of tokens_allocated
async function getAuctionGifts(auctionId: number, tokenMint: PublicKey): Promise<BN> {
  const pool = new sql.ConnectionPool(DB_CONFIG);
  try {
    await pool.connect();
    const request = pool.request();

    request.input('auction_id', sql.Int, auctionId);
    request.input('pubkey', sql.NVarChar(255), tokenMint.toBase58());

    const query = `
      SELECT CONVERT(varchar, ISNULL(SUM([tokens_allocated]), 0)) as total_tokens_allocated
      FROM [dbo].[auction_airdrop]
      WHERE [auction_id] = @auction_id AND [pubkey] = @pubkey
    `;

    const result = await request.query(query);
    const totalTokensAllocatedStr = result.recordset[0].total_tokens_allocated;
    const totalGiftTokens = new BN(totalTokensAllocatedStr);

    console.log(`getAuctionGifts -> auction_id: ${auctionId}, pubkey: ${tokenMint.toBase58()}, total_tokens_allocated: ${totalGiftTokens.toString()}`);

    return totalGiftTokens;
  } catch (error) {
    console.error('Error fetching auction gifts:', error);
    throw error;
  } finally {
    await pool.close();
  }
}

// Updated reserveAuctionGifts to use totalGiftTokens and maintain liquidity ratio
async function reserveAuctionGifts(
  liquidityTokens: BN,
  liquidityWSol: BN,
  totalGiftTokens: BN,
  tokenMint: PublicKey,
  adminKp: Keypair,
  connection: Connection
) {
  console.log(`reserveAuctionGifts -> totalGiftTokens: ${totalGiftTokens.toString()}`);

  if (totalGiftTokens.isZero()) {
    console.log(`reserveAuctionGifts -> No gifts to process`);
    return {
      giftTokens: new BN(0),
      giftSol: new BN(0),
      liquidityTokensAfterGifts: liquidityTokens,
      liquidityWSolAfterGifts: liquidityWSol
    };
  }

  if (totalGiftTokens.gt(liquidityTokens)) {
    throw new Error(`Total gift tokens (${totalGiftTokens.toString()}) exceed available liquidity tokens (${liquidityTokens.toString()})`);
  }

  const giftTokens = totalGiftTokens;
  const giftSol = giftTokens.mul(liquidityWSol).div(liquidityTokens);

  if (giftSol.gt(liquidityWSol)) {
    throw new Error(`Calculated gift SOL (${giftSol.toString()}) exceeds available liquidity WSOL (${liquidityWSol.toString()})`);
  }

  console.log(`reserveAuctionGifts -> giftTokens: ${giftTokens.toString()}`);
  console.log(`reserveAuctionGifts -> giftSol: ${giftSol.toString()}`);

  const liquidityTokensAfterGifts = liquidityTokens.sub(giftTokens);
  const liquidityWSolAfterGifts = liquidityWSol.sub(giftSol);

  console.log(`reserveAuctionGifts -> liquidityTokensAfterGifts: ${liquidityTokensAfterGifts.toString()}`);
  console.log(`reserveAuctionGifts -> liquidityWSolAfterGifts: ${liquidityWSolAfterGifts.toString()}`);

  if (giftTokens.gt(new BN(0))) {
    const adminTokenAccount = getAssociatedTokenAddressSync(tokenMint, adminKp.publicKey);
    const giftHoldingTokenAccount = getAssociatedTokenAddressSync(tokenMint, GIFT_HOLDING_ACCOUNT, true);

    const giftTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        adminKp.publicKey,
        giftHoldingTokenAccount,
        GIFT_HOLDING_ACCOUNT,
        tokenMint,
        TOKEN_PROGRAM_ID
      ),
      createTransferInstruction(
        adminTokenAccount,
        giftHoldingTokenAccount,
        adminKp.publicKey,
        BigInt(giftTokens.toString()),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    giftTx.feePayer = adminKp.publicKey;
    giftTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    const giftSig = await withRetry(() => sendAndConfirmTransaction(connection, giftTx, [adminKp]));

    const mintAccount = await withRetry(() => getMint(connection, tokenMint));
    await logSuccessTx(connection, giftSig, `reserveAuctionGifts => Sent ${giftTokens.toNumber() / 10 ** mintAccount.decimals} gift tokens to GIFT_HOLDING_ACCOUNT`);
  }

  return {
    giftTokens,
    giftSol,
    liquidityTokensAfterGifts,
    liquidityWSolAfterGifts
  };
}

// Remaining functions (withdrawFunds, createAndFundPool_v2_AMM, createAndFundPool_v3_CLMM, updateKeyPairPoolInfo, logSuccessTx, getTransactionDetailsWithRetry, sleep, convertValue, logObject, clmmDevConfigs, buyAndBurn) remain unchanged
async function withdrawFunds(program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, adminKp: Keypair, connection: Connection):
  Promise<{
    solAmount: bigint;
    tokenAmount: bigint;
    tokenMint: PublicKey;
    adminTokenAccount: PublicKey;
  }> {
  const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_DATA_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
  const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_SOL_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
  const auctionDataFetched = await program.account.auction.fetch(auctionData);
  const tokenMint = auctionDataFetched.tokenMint;
  const auctionTokenAccount = getAssociatedTokenAddressSync(tokenMint, auctionSol, true); // Allow off-curve for PDA
  const adminTokenAccount = getAssociatedTokenAddressSync(tokenMint, adminKp.publicKey);
  await createAssociatedTokenAccountIdempotent(connection, adminKp, tokenMint, adminKp.publicKey);

  if (auctionDataFetched.isSolWithdrawn) {
    console.error(`migrateAuction (${auctionId}) => SOL already withdrawn`);
    return { solAmount: BigInt(0), tokenAmount: BigInt(0), tokenMint, adminTokenAccount };
  }
  if (auctionDataFetched.isTokensWithdrawn) {
    console.error(`migrateAuction (${auctionId}) => Tokens already withdrawn`);
    return { solAmount: BigInt(0), tokenAmount: BigInt(0), tokenMint, adminTokenAccount };
  }

  // Withdraw SOL
  const solBefore = BigInt(await connection.getBalance(auctionSol));
  console.log('calling withdrawSol...'); // ###
  const withdrawSolSig = await program.methods
    .withdrawSol()
    .accounts({
      admin: adminKp.publicKey,
      auctionDataAccount: auctionData,
      auctionSolAccount: auctionSol,
    })
    .signers([adminKp])
    .rpc();
  await logSuccessTx(connection, withdrawSolSig, `withdrawSol TX`);
  console.log(`withdrawFunds -> ${withdrawSolSig} migrateAuction (${auctionId}) => Withdrawn SOL`);

  const solAfter = BigInt(await connection.getBalance(auctionSol));
  const solWithdrawn = solBefore - solAfter;

  // Withdraw Tokens
  const tokenBefore = BigInt((await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount);
  console.log('calling withdrawTokens...');
  const withdrawTokenSig = await program.methods
    .withdrawTokens() // ###
    .accounts({
      admin: adminKp.publicKey,
      auctionDataAccount: auctionData,
      auctionSolAccount: auctionSol,
      auctionTokenAccount: auctionTokenAccount,
      adminTokenAccount: adminTokenAccount,
    })
    .signers([adminKp])
    .rpc();
  await logSuccessTx(connection, withdrawTokenSig, `withdrawTokens TX`);
  console.log(`withdrawFunds -> ${withdrawTokenSig} migrateAuction (${auctionId}) => Withdrawn tokens`);
  const tokenAfter = BigInt((await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount);
  const tokenWithdrawn = tokenBefore - tokenAfter;

  return { solAmount: solWithdrawn, tokenAmount: tokenWithdrawn, tokenMint, adminTokenAccount };
}

async function createAndFundPool_v2_AMM(
  program: Program<MaxiAuction>,
  isMainnet: boolean,
  auctionId: number,
  tokenMint: PublicKey,
  tokenAmount: bigint,
  wsolAmount: bigint,
  adminKp: Keypair,
  connection: Connection,
  auctionClearingPrice: number
):
  Promise<{
    marketId: PublicKey;
    poolId: PublicKey;
    marketInfo: Object;
    poolKeys: Object;
  }> {
  // Get initial SOL balance of the admin
  const initialBalance = await connection.getBalance(adminKp.publicKey);

  const raydium = await Raydium.load({
    connection,
    owner: adminKp,
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });
  const mintAccount = await getMint(connection, tokenMint);
  const baseDecimals = mintAccount.decimals;
  const initialPrice = new Decimal(auctionClearingPrice / LAMPORTS_PER_SOL);

  // Create market
  console.log(`createAndFundPool_v2_AMM -> raydium.marketV2.create: mintAccount ${tokenMint.toBase58()}, baseDecimals ${baseDecimals}...`);
  const { execute: execCM, extInfo: extInfoCM } = await raydium.marketV2.create({
    baseInfo: { mint: tokenMint, decimals: baseDecimals, },
    quoteInfo: { mint: WSOLMint, decimals: 9, }, // WSOL
    lotSize: 1,
    tickSize: 0.01,
    dexProgramId: isMainnet ? OPEN_BOOK_PROGRAM : DEVNET_PROGRAM_ID.OPENBOOK_MARKET,
    txVersion: TxVersion.LEGACY,
  });
  const cmSigs = await execCM({ sequentially: true });
  cmSigs.txIds.forEach(x => console.log(`createAndFundPool_v2_AMM -> ${x} createAndFundPool (${auctionId}) => execCM OK`));
  const marketId = extInfoCM.address.marketId;
  const marketInfo = Object.keys(extInfoCM.address).reduce(
    (acc, cur) => ({ ...acc, [cur]: extInfoCM.address[cur as keyof typeof extInfoCM.address].toBase58(), }),
    {}
  );

  // Calculate cost of market creation
  const balanceAfterMarketCreation = await connection.getBalance(adminKp.publicKey);
  const marketCreationCost = (initialBalance - balanceAfterMarketCreation) / LAMPORTS_PER_SOL;

  // Create & fund the pool
  const marketBufferInfo = await raydium.connection.getAccountInfo(marketId);
  if (!marketBufferInfo) throw new Error('Failed to fetch market account info');
  const { baseMint, quoteMint } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo.data);
  const baseMintInfo = await raydium.token.getTokenInfo(baseMint);
  const quoteMintInfo = await raydium.token.getTokenInfo(quoteMint);
  if (baseMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58() || quoteMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58()) {
    throw new Error('base or quote mint is not a supported token type');
  }
  const baseAmount = new BN(tokenAmount.toString());
  const quoteAmount = new BN(wsolAmount.toString());
  console.log(`createAndFundPool_v2_AMM -> baseAmount (tokens)`, baseAmount.toString());
  console.log(`createAndFundPool_v2_AMM -> quoteAmount (lamports)`, quoteAmount.toString());
  if (baseAmount.mul(quoteAmount).lte(new BN(1).mul(new BN(10 ** baseMintInfo.decimals)).pow(new BN(2)))) {
    throw new Error('initial liquidity too low');
  }
  const { execute: execCP, extInfo: extInfoCP } = await raydium.liquidity.createPoolV4({
    programId: isMainnet ? AMM_V4 : DEVNET_PROGRAM_ID.AmmV4,
    marketInfo: { marketId, programId: isMainnet ? OPEN_BOOK_PROGRAM : DEVNET_PROGRAM_ID.OPENBOOK_MARKET, },
    baseMintInfo: { mint: baseMint, decimals: baseMintInfo.decimals },
    quoteMintInfo: { mint: quoteMint, decimals: quoteMintInfo.decimals },
    baseAmount,
    quoteAmount,
    startTime: new BN(0),
    ownerInfo: { useSOLBalance: true },
    associatedOnly: false,
    txVersion: TxVersion.LEGACY,
    feeDestinationId: isMainnet ? FEE_DESTINATION_ID : DEVNET_PROGRAM_ID.FEE_DESTINATION_ID,
  });
  const { txId: cpSig } = await execCP({ sendAndConfirm: true });
  console.log(`createAndFundPool_v2_AMM -> ${cpSig} (${auctionId}) => execCP OK`);
  const poolId = extInfoCP.address.ammId;
  const poolKeys = Object.keys(extInfoCP.address).reduce(
    (acc, cur) => ({ ...acc, [cur]: extInfoCP.address[cur as keyof typeof extInfoCP.address].toBase58(), }),
    {}
  );

  // Calculate total cost and breakdown
  const finalBalance = await connection.getBalance(adminKp.publicKey);
  const poolCreationCost = (balanceAfterMarketCreation - finalBalance) / LAMPORTS_PER_SOL;
  const totalSolSpent = (initialBalance - finalBalance) / LAMPORTS_PER_SOL;
  const fundingAmountSol = Number(wsolAmount) / LAMPORTS_PER_SOL;
  const estimatedFeesAndRent = poolCreationCost - fundingAmountSol;

  // Log the costs
  console.log(`Market creation cost (fees and rent deposits): ${marketCreationCost.toFixed(6)} SOL`);
  console.log(`Pool creation and funding:`);
  console.log(`  - Funding amount: ${fundingAmountSol.toFixed(6)} SOL`);
  console.log(`  - Estimated fees and rent deposits: ${estimatedFeesAndRent.toFixed(6)} SOL`);
  console.log(`Total SOL cost to admin: ${totalSolSpent.toFixed(6)} SOL`);

  // Check price (unchanged)
  console.log(`createAndFundPool_v2_AMM -> poolId`, poolId.toBase58());
  const res = await raydium.liquidity.getRpcPoolInfos([poolId.toBase58()]);
  const poolPrice = Number(res[poolId.toBase58()].poolPrice);
  console.log(`createAndFundPool_v2_AMM -> getRpcPoolInfos -> res`, res);
  console.log(`createAndFundPool_v2_AMM -> getRpcPoolInfos -> poolPrice`, poolPrice);
  console.log(`createAndFundPool_v2_AMM -> getRpcPoolInfos -> initialPrice`, initialPrice.toNumber());
  if (Math.abs(initialPrice.toNumber() - poolPrice) > 1e-6) {
    console.log(`createAndFundPool_v2_AMM -> Current price mismatch`);
    throw new Error('Current price mismatch');
  }

  return { marketId, poolId, marketInfo, poolKeys };
}

async function createAndFundPool_v3_CLMM(
  program: Program<MaxiAuction>,
  isMainnet: boolean,
  auctionId: number,
  tokenMint: PublicKey,
  tokenAmount: bigint,
  wsolAmount: bigint,
  adminKp: Keypair,
  connection: Connection,
  auctionClearingPrice: number
): Promise<{
  poolId: PublicKey;
  poolKeys: Object;
  marketId: PublicKey;
  marketInfo: Object;
}> {
  console.log(`createAndFundPool_v3_CLMM...`);
  let totalFee = 0; // Initialize total fee tracker
  const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'finalized' });

  const mintAccount = await getMint(connection, tokenMint);
  const tokenDecimals = mintAccount.decimals;
  const initialPrice = new Decimal(auctionClearingPrice / LAMPORTS_PER_SOL);

  console.log(`createAndFundPool_v3_CLMM -> auctionClearingPrice`, auctionClearingPrice);
  console.log(`createAndFundPool_v3_CLMM -> initialPrice (SOL)`, initialPrice);
  console.log(`createAndFundPool_v3_CLMM -> wsolAmount (SOL)`, Number(wsolAmount.toString()) / LAMPORTS_PER_SOL);
  console.log(`createAndFundPool_v3_CLMM -> tokenAmount (tokens)`, Number(tokenAmount.toString()) / 10 ** tokenDecimals);

  // Create and log fees for token ATA
  const adminTokenAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, tokenMint, adminKp.publicKey);
  // Note: Fee tracking removed as txId is not available on Account type

  // Create and log fees for WSOL ATA
  const adminWsolAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, WSOLMint, adminKp.publicKey);
  // Note: Fee tracking removed as txId is not available on Account type

  // Check balances
  const solBalance = await connection.getBalance(adminKp.publicKey);
  const tokenBalance = (await connection.getTokenAccountBalance(adminTokenAccount.address)).value.amount;
  const wsolBalance = (await connection.getTokenAccountBalance(adminWsolAccount.address)).value.amount;
  console.log(`createAndFundPool_v3_CLMM -> solBalance`, solBalance / LAMPORTS_PER_SOL);
  console.log(`createAndFundPool_v3_CLMM -> tokenBalance`, Number(tokenBalance) / 10 ** tokenDecimals);
  console.log(`createAndFundPool_v3_CLMM -> wsolBalance`, Number(wsolBalance) / LAMPORTS_PER_SOL);
  if (new BN(tokenBalance).lt(new BN(tokenAmount.toString()))) {
    console.log(`createAndFundPool_v3_CLMM -> Insufficient token balance: have ${tokenBalance}, need ${tokenAmount.toString()}`);
    throw new Error(`Insufficient token balance: have ${tokenBalance}, need ${tokenAmount.toString()}`);
  }
  if (new BN(wsolBalance).lt(new BN(wsolAmount.toString()))) {
    console.log(`createAndFundPool_v3_CLMM -> Insufficient wsol balance: have ${wsolBalance}, need ${wsolAmount.toString()}`);
    throw new Error(`Insufficient wsol balance: have ${wsolBalance}, need ${wsolAmount.toString()}`);
  }
  console.log(`createAndFundPool_v3_CLMM -> balances ok.`);

  const clmmProgramId = isMainnet ? CLMM_PROGRAM_ID : DEVNET_PROGRAM_ID.CLMM;
  const chainId = isMainnet ? 101 : 103;

  var logoURI = '';
  const accountInfo = await connection.getAccountInfo(tokenMint);
  if (!accountInfo) {
    console.log(`createAndFundPool_v3_CLMM -> Mint account not found: ${tokenMint.toBase58()}`);
    throw new Error(`Mint account not found: ${tokenMint.toBase58()}`);
  }
  if (!accountInfo.owner.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'))) {
    console.log(`createAndFundPool_v3_CLMM -> Invalid owner for ${tokenMint.toBase58()}: got ${accountInfo.owner.toBase58()}`);
    throw new Error(`Invalid owner for ${tokenMint.toBase58()}: got ${accountInfo.owner.toBase58()}`);
  }

  const tokenInfo: ApiV3Token = {
    chainId,
    address: tokenMint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    symbol: 'UNKNOWN',
    name: 'Unknown Token',
    decimals: tokenDecimals,
    tags: ['maxi'],
    logoURI,
    extensions: {},
  };
  const wsolInfo: ApiV3Token = {
    chainId,
    address: WSOLMint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    tags: ['wrapped', 'solana'],
    logoURI: '',
    extensions: {},
  };

  // Create CLMM pool and log fee
  var clmmConfigs = isMainnet ? await raydium.api.getClmmConfigs() : clmmDevConfigs;
  const ammConfig = { ...clmmConfigs[0], id: new PublicKey(clmmConfigs[0].id), fundOwner: '', description: '' };
  const { execute: execCreatePool, extInfo: poolExtInfo } = await raydium.clmm.createPool({
    programId: clmmProgramId,
    mint1: tokenInfo,
    mint2: wsolInfo,
    ammConfig,
    initialPrice,
    txVersion: TxVersion.LEGACY,
  });
  const createPoolTx = await execCreatePool({ sendAndConfirm: true });
  console.log(`createAndFundPool_v3_CLMM -> ${createPoolTx.txId} createAndFundPool (${auctionId}) => Pool created`);
  const createTxDetails = await connection.getTransaction(createPoolTx.txId, { commitment: 'confirmed' });
  const createFee = createTxDetails.meta.fee / LAMPORTS_PER_SOL;
  console.log(`createAndFundPool_v3_CLMM -> Create pool transaction fee: ${createFee} SOL`);
  totalFee += createFee;
  const poolId = (poolExtInfo.address as any)["poolId"];
  console.log(`createAndFundPool_v3_CLMM -> poolId`, poolId.toBase58());

  // Fetch pool info to get tick spacing
  const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const tickSpacing = (poolInfo.poolInfo as any)["tickSpacing"];

  // Set full range ticks
  const MIN_TICK = -443636;
  const MAX_TICK = 443636;
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  console.log(`createAndFundPool_v3_CLMM -> tickLower: ${tickLower}, tickUpper: ${tickUpper}`);

  // Open full range liquidity position and log fee
  const baseAmount = new BN(tokenAmount.toString());

  // TODO: why can't we get this exact??
  // Define the buffer as 0.2% of wsolAmount
  const bufferPercent = 20; // 0.2% = 20 basis points (since BN doesn't support decimals directly)
  const buffer = new BN(wsolAmount.toString()).mul(new BN(bufferPercent)).div(new BN(10000));
  const otherAmountMax = new BN(wsolAmount.toString()).add(buffer);
  console.log(`createAndFundPool_v3_CLMM -> baseAmount`, Number(baseAmount.toString()) / 10 ** tokenDecimals);
  console.log(`createAndFundPool_v3_CLMM -> otherAmountMax`, Number(otherAmountMax.toString()) / LAMPORTS_PER_SOL);
  console.log(`createAndFundPool_v3_CLMM -> buffer`, Number(buffer.toString()) / LAMPORTS_PER_SOL);

  const { execute: execOpenPosition } = await raydium.clmm.openPositionFromBase({
    computeBudgetConfig: {
      units: 6000000,
      microLamports: 46591500,
    },
    poolInfo: poolInfo.poolInfo,
    poolKeys: poolExtInfo.address,
    tickLower,
    tickUpper,
    base: 'MintB',
    ownerInfo: { useSOLBalance: false },
    baseAmount,
    otherAmountMax,
    txVersion: TxVersion.LEGACY,
  });
  const positionTx = await execOpenPosition({ sendAndConfirm: true });
  console.log(`createAndFundPool_v3_CLMM -> ${positionTx.txId} createAndFundPool (${auctionId}) => Full range position opened`);
  const positionTxDetails = await connection.getTransaction(positionTx.txId, { commitment: 'confirmed' });
  const positionFee = positionTxDetails.meta.fee / LAMPORTS_PER_SOL;
  console.log(`createAndFundPool_v3_CLMM -> Open position transaction fee: ${positionFee} SOL`);
  totalFee += positionFee;

  // Fetch and verify pool price
  const poolInfoRpc = (await raydium.clmm.getRpcClmmPoolInfos({ poolIds: [poolId] }))[poolId];
  console.log(`createAndFundPool_v3_CLMM -> poolInfoRpc.currentPrice: ${poolInfoRpc.currentPrice}`);
  console.log(`createAndFundPool_v3_CLMM -> 1 / poolInfoRpc.currentPrice: ${1 / poolInfoRpc.currentPrice}`);
  console.log(`createAndFundPool_v3_CLMM -> initialPrice: ${initialPrice}`);
  if (Math.abs(initialPrice.toNumber() - 1 / poolInfoRpc.currentPrice) > 1e-6) {
    console.log(`createAndFundPool_v3_CLMM -> Current price mismatch`);
    throw new Error('Current price mismatch');
  }

  // Log total SOL cost
  console.log(`createAndFundPool_v3_CLMM -> Total SOL cost to admin: ${totalFee} SOL`);

  return { poolId, poolKeys: poolExtInfo, marketInfo: {}, marketId: null };
}

export const updateKeyPairPoolInfo = async (tokenMint, marketInfo, poolKeys, marketId, poolId) => {
  const pool = new sql.ConnectionPool(DB_CONFIG);
  try {
    // Establish database connection
    await pool.connect();
    const request = pool.request();

    // Prepare input parameters
    const publicKey = tokenMint.toBase58();
    request.input('PublicKey', sql.VarChar(255), publicKey);
    request.input('pool_id', sql.NVarChar(44), poolId.toBase58());
    request.input('pool_keys', sql.NVarChar(sql.MAX), JSON.stringify(poolKeys));
    //request.input('market_info', sql.NVarChar(sql.MAX), JSON.stringify(marketInfo));
    //request.input('market_id', sql.NVarChar(44), marketId.toBase58());

    // SQL update query
    const query = `
      UPDATE [dbo].[KeyPair]
      SET [pool_keys] = @pool_keys,
          [pool_id] = @pool_id
          --[market_info] = @market_info,
          --[market_id] = @market_id,
      WHERE [PublicKey] = @PublicKey
    `;

    // Execute the query
    const result = await request.query(query);

    // Check if a row was updated
    if (result.rowsAffected[0] === 0) {
      console.warn(`updateKeyPairPoolInfo -> No row found with PublicKey: ${publicKey}`);
      //throw new Error(`No row found with PublicKey: ${publicKey}`);
    }

    console.log(`updateKeyPairPoolInfo -> Successfully updated row with PublicKey: ${publicKey}`);
  } catch (error) {
    console.error('Error updating KeyPair table:', error);
    throw error; // Re-throw the error for the caller to handle
  } finally {
    // Ensure the connection is closed
    await pool.close();
  }
};

async function logSuccessTx(connection, sig, label) {
  const txDetails = await getTransactionDetailsWithRetry(connection, sig);
  if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
    console.log(`logSuccessTx -> ${sig} ${label}`);
    console.log("logSuccessTx -> logs:", txDetails.meta.logMessages);
  } else {
    console.log("No logs available for this transaction.");
  }
}

async function getTransactionDetailsWithRetry(connection, signature, maxAttempts = 5, retryDelay = 1000) {
  let txDetails = null;
  let attempts = 0;

  while (txDetails === null && attempts < maxAttempts) {
    txDetails = await connection.getTransaction(signature, { commitment: 'confirmed' });
    if (txDetails === null) {
      console.log(`Transaction details not yet available for signature ${signature}, retrying in ${retryDelay / 1000} second(s)...`);
      await sleep(retryDelay / 1000);
    }
    attempts++;
  }

  if (txDetails === null) {
    throw new Error(`Failed to fetch transaction details for signature ${signature} after ${maxAttempts} attempts`);
  }

  return txDetails;
}

const sleep = async (secs) => {
  await new Promise(resolve => setTimeout(resolve, secs * 1000));
}

function convertValue(value) {
  if (value instanceof BN) {
    return value.toString(10);
  } else if (value instanceof PublicKey) {
    return value.toBase58();
  } else if (Array.isArray(value)) {
    return value.map(convertValue);
  } else if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, convertValue(val)])
    );
  }
  return value;
}
function logObject(label, obj) {
  const convertedObj = convertValue(obj);
  console.log(label, convertedObj);
}

export const clmmDevConfigs = [
  {
    id: 'CQYbhr6amxUER4p5SC44C63R4qw4NFc9Z4Db9vF4tZwG',
    index: 0,
    protocolFeeRate: 120000,
    tradeFeeRate: 100,
    tickSpacing: 10,
    fundFeeRate: 40000,
    description: 'Best for very stable pairs',
    defaultRange: 0.005,
    defaultRangePoint: [0.001, 0.003, 0.005, 0.008, 0.01],
  },
  {
    id: 'B9H7TR8PSjJT7nuW2tuPkFC63z7drtMZ4LoCtD7PrCN1',
    index: 1,
    protocolFeeRate: 120000,
    tradeFeeRate: 2500,
    tickSpacing: 60,
    fundFeeRate: 40000,
    description: 'Best for most pairs',
    defaultRange: 0.1,
    defaultRangePoint: [0.01, 0.05, 0.1, 0.2, 0.5],
  },
  {
    id: 'GjLEiquek1Nc2YjcBhufUGFRkaqW1JhaGjsdFd8mys38',
    index: 3,
    protocolFeeRate: 120000,
    tradeFeeRate: 10000,
    tickSpacing: 120,
    fundFeeRate: 40000,
    description: 'Best for exotic pairs',
    defaultRange: 0.1,
    defaultRangePoint: [0.01, 0.05, 0.1, 0.2, 0.5],
  },
  {
    id: 'GVSwm4smQBYcgAJU7qjFHLQBHTc4AdB3F2HbZp6KqKof',
    index: 2,
    protocolFeeRate: 120000,
    tradeFeeRate: 500,
    tickSpacing: 10,
    fundFeeRate: 40000,
    description: 'Best for tighter ranges',
    defaultRange: 0.1,
    defaultRangePoint: [0.01, 0.05, 0.1, 0.2, 0.5],
  },
]

export async function buyAndBurn(
  giftSol: BN,
  tokenMint: PublicKey,
  poolId: PublicKey,
  adminKp: Keypair,
  connection: Connection,
  isMainnet: boolean
): Promise<void> {
  console.log(`[buyAndBurn] Starting execution...`);
  console.log(`[buyAndBurn] Parameters - giftSol: ${giftSol.toString()}, tokenMint: ${tokenMint.toBase58()}, poolId: ${poolId.toBase58()}`);

  try {
    // Initialize Raydium SDK
    const raydium = await Raydium.load({
      connection,
      owner: adminKp,
      disableFeatureCheck: true,
      blockhashCommitment: 'finalized',
    });
    console.log(`[buyAndBurn] Raydium SDK initialized for ${isMainnet ? 'mainnet' : 'devnet'}`);

    // Define WSOL mint (assuming a constant like TOKEN_WSOL.address exists)
    const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // Replace with your constant if different
    const inputMint = WSOL_MINT.toBase58();

    // Fetch pool information (matching canonical example)
    let poolInfo: ApiV3PoolInfoConcentratedItem;
    let poolKeys: ClmmKeys | undefined;
    let clmmPoolInfo: ComputeClmmPoolInfo;
    let tickCache: ReturnTypeFetchMultiplePoolTickArrays;

    /*if (isMainnet) {
      const data = await raydium.api.fetchPoolById({ ids: poolId.toBase58() });
      poolInfo = data[0] as ApiV3PoolInfoConcentratedItem;
      if (!poolInfo.programId == new PublicKey('CLMM9tU3VfNLvRYM75zxezoEL9yNoyMzACW5wUdfXkz6').toString()) {
        throw new Error('Target pool is not a CLMM pool');
      }
      clmmPoolInfo = await PoolUtils.fetchComputeClmmInfo({
        connection: raydium.connection,
        poolInfo,
      });
      tickCache = await PoolUtils.fetchMultiplePoolTickArrays({
        connection: raydium.connection,
        poolKeys: [clmmPoolInfo],
      });
    } else*/ {
      const data = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
      poolInfo = data.poolInfo;
      poolKeys = data.poolKeys;
      clmmPoolInfo = data.computePoolInfo;
      tickCache = data.tickData;
    }
    console.log(`[buyAndBurn] Pool info fetched - mintA: ${poolInfo.mintA.address}, mintB: ${poolInfo.mintB.address}, price: ${poolInfo.price}`);

    // Validate input mint
    if (inputMint !== poolInfo.mintA.address && inputMint !== poolInfo.mintB.address) {
      throw new Error(`Input mint ${inputMint} does not match pool mints (${poolInfo.mintA.address}, ${poolInfo.mintB.address})`);
    }
    const baseIn = inputMint === poolInfo.mintA.address;
    console.log(`[buyAndBurn] Input mint is ${baseIn ? 'mintA' : 'mintB'}`);

    // Compute amount out (matching canonical example)
    const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolInfo,
      tickArrayCache: tickCache[poolId.toBase58()],
      amountIn: giftSol,
      tokenOut: poolInfo[baseIn ? 'mintB' : 'mintA'],
      slippage: 0.01, // 1% slippage as in canonical example
      epochInfo: await raydium.fetchEpochInfo(),
    });
    console.log(`[buyAndBurn] Computed - minAmountOut: ${minAmountOut.amount.raw.toString()}, remainingAccounts: ${remainingAccounts.length}`);

    // Execute swap (matching canonical example)
    const { execute } = await raydium.clmm.swap({
      poolInfo,
      poolKeys,
      inputMint,
      amountIn: giftSol,
      amountOutMin: minAmountOut.amount.raw,
      observationId: clmmPoolInfo.observationId,
      ownerInfo: {
        useSOLBalance: false, // Using WSOL ATA, not native SOL
      },
      remainingAccounts,
      txVersion: TxVersion.LEGACY, // Matches canonical example's default
    });
    console.log(`[buyAndBurn] Swap prepared, executing...`);
    const { txId } = await execute({ sendAndConfirm: true });
    await logSuccessTx(connection, txId, `[buyAndBurn] Swap executed - ${giftSol.toNumber() / 1e9} WSOL swapped`);
    console.log(`[buyAndBurn] Swap Tx: ${txId}`);

    // Get token balance after swap
    const adminTokenAccount = getAssociatedTokenAddressSync(tokenMint, adminKp.publicKey);
    const tokenBalanceAfter = await connection.getTokenAccountBalance(adminTokenAccount);
    const tokensReceived = new BN(tokenBalanceAfter.value.amount);
    console.log(`[buyAndBurn] Tokens received: ${tokensReceived.toString()}`);

    // Burn tokens if received
    if (tokensReceived.gt(new BN(0))) {
      const NULL_ACCOUNT = new PublicKey('11111111111111111111111111111111');
      const nullTokenAccount = getAssociatedTokenAddressSync(tokenMint, NULL_ACCOUNT, true);

      const burnTx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          adminKp.publicKey,
          nullTokenAccount,
          NULL_ACCOUNT,
          tokenMint,
          TOKEN_PROGRAM_ID
        ),
        createTransferInstruction(
          adminTokenAccount,
          nullTokenAccount,
          adminKp.publicKey,
          BigInt(tokensReceived.toString()),
          [],
          TOKEN_PROGRAM_ID
        )
      );
      burnTx.feePayer = adminKp.publicKey;
      burnTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
      const burnSig = await sendAndConfirmTransaction(connection, burnTx, [adminKp]);
      const mintAccount = await getMint(connection, tokenMint);
      await logSuccessTx(connection, burnSig, `[buyAndBurn] Burned ${tokensReceived.toNumber() / 10 ** mintAccount.decimals} tokens`);
      console.log(`[buyAndBurn] Burn Tx: ${burnSig}`);
    } else {
      console.log(`[buyAndBurn] No tokens received to burn`);
    }

  } catch (error) {
    console.error(`[buyAndBurn] Error occurred:`, error.message);
    if (error.transactionMessage) {
      console.error(`[buyAndBurn] Transaction message: ${error.transactionMessage}`);
    }
    if (error.transactionLogs) {
      console.error(`[buyAndBurn] Transaction logs:`, error.transactionLogs);
    }
    throw error; // Re-throw to allow caller to handle
  }
}