import * as anchor from "@coral-xyz/anchor";
import { Decimal } from 'decimal.js';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "bn.js";
import {
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Raydium, TxVersion, DEVNET_PROGRAM_ID, CLMM_PROGRAM_ID, WSOLMint, AMM_V4, OPEN_BOOK_PROGRAM, FEE_DESTINATION_ID, MARKET_STATE_LAYOUT_V3, TOKEN_WSOL, ApiV3Token, TickUtils } from '@raydium-io/raydium-sdk-v2';
import { getMint, getOrCreateAssociatedTokenAccount, createSyncNativeInstruction, createTransferInstruction } from '@solana/spl-token';
import { Connection, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { MaxiAuction } from "../target/types/maxi_auction";
import "dotenv/config";
import * as sql from "mssql";

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

// migrate auction liquidity to a new raydium pool
// https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/amm
export const migrateAuction = async (program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, adminKp: Keypair, connection: Connection) => {

  try {
    // abort if min sol is not reached - user's will claim back their sol in full
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_DATA_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(AUCTION_SOL_SEED), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionDataFetched = await program.account.auction.fetch(auctionData);
    if (auctionDataFetched.lastStatus?.failedMinNotReached) {
      throw new Error('failedMinNotReached');
    }
    if (auctionDataFetched.clearingPrice.lte(new BN(0))) {
      throw new Error('invalid clearing price');
    }
    //console.log(`auctionDataFetched`, auctionDataFetched); // how to get status?

    // need to make sure config.TEST_MIN_TOTAL_SOL > FIXED_MIN_SOL_LIQ, so that test above will fail and bidders cant then claim back their tokens
    const FIXED_MIN_SOL_LIQ = isMainnet
      ? new BN(10.00 * LAMPORTS_PER_SOL)  // TODO: test/tune thereshold for prod, e.g. (1b + 6 decimals)
      : new BN(0.001 * LAMPORTS_PER_SOL); // assumes avg. 50 base tokens supplied with 3 decimals, i.e. test case setup

    // and we have a min total sol bid threshold, so we can cover raydium setup costs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_INFO_SEED)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const CONFIG_MIN_TOTAL_SOL = globalInfoAccount.config.minTotalSol;

    // ### this MUST MATCH the fixed amount in place_bid's calculation of acution.liquidity_sol ###
    // TEST LOW VALUE FOR DEVNET...
    const FIXED_SOL_RAYDIUM_COSTS = new BN(0.000025 * LAMPORTS_PER_SOL); // todo: should be ~0.25 sol on mainnet...
    //const FIXED_SOL_RAYDIUM_COSTS = new BN(0); // testing zero fees
    // isMainnet
    // ? new BN(4.0 * LAMPORTS_PER_SOL)       // prod ~4 sol for raydium setup costs
    // : new BN(0.000042 * LAMPORTS_PER_SOL); // don't care on devnet

    console.log(`MIN_SOL_LIQ`, FIXED_MIN_SOL_LIQ.toString());
    console.log(`CONFIG_MIN_TOTAL_SOL`, CONFIG_MIN_TOTAL_SOL.toString());
    console.log(`FIXED_SOL_RAYDIUM_COSTS`, FIXED_SOL_RAYDIUM_COSTS.toString());
    // if (FIXED_SOL_RAYDIUM_COSTS.mul(new BN(2)).gt(CONFIG_MIN_TOTAL_SOL)) { // sanitize config vs. actual costs
    //   throw new Error('CONFIG_MIN_TOTAL_SOL is too low');
    // }
    if (CONFIG_MIN_TOTAL_SOL.lt(FIXED_SOL_RAYDIUM_COSTS.mul(new BN(2)))) { // sanity check
      console.log(`CONFIG_MIN_TOTAL_SOL is too low: ${CONFIG_MIN_TOTAL_SOL.toString()} < ${FIXED_SOL_RAYDIUM_COSTS.mul(new BN(2)).toString()}`);
      throw new Error('CONFIG_MIN_TOTAL_SOL is too low');
    }

    // validate min sol bid thresholds
    const { solAmount: solWithdrawn, tokenAmount: tokensWithdrawn, tokenMint, adminTokenAccount } = await withdrawFunds(program, isMainnet, auctionId, adminKp, connection);
    const mintAccount = await getMint(connection, tokenMint);
    console.log(`migrateAuction => Withdrawn ${solWithdrawn.toString()} lamports and ${tokensWithdrawn.toString()} tokens`);
    console.log(`solWithdrawn`, solWithdrawn.toString());
    if (new BN(solWithdrawn.toString()).lt(new BN(FIXED_MIN_SOL_LIQ.toString()))) {    // to satsify raydium fixed product 
      throw new Error('solWithdrawn is too low: MIN_SOL_LIQ');
    }
    if (new BN(solWithdrawn.toString()).lt(new BN(CONFIG_MIN_TOTAL_SOL.toString()))) { // to cover our costs 
      throw new Error('solWithdrawn is too low: CONFIG_MIN_TOTAL_SOL #### SHOULD NOT HAPPEN! auction state should be failed, and admin withdraw not allowed #####');
    }

    //
    // calc how much sol to wrap - we keep setup costs in sol
    //
    const liquidityWSol = new BN(solWithdrawn.toString()).sub(FIXED_SOL_RAYDIUM_COSTS);
    if (liquidityWSol.lte(new BN(0))) throw new Error('liquidityWSol is too low');
    console.log(`liquidityWSol`, liquidityWSol.toString()); // check: should be exactly == computed s_lamports in place_bid.rs...

    // Wrap admin's withdrawn sol, less fixed raydium costs
    const adminWsolAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, new PublicKey(TOKEN_WSOL.address), adminKp.publicKey);
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKp.publicKey,
        toPubkey: adminWsolAccount.address,
        lamports: BigInt(liquidityWSol.toString()),
      }),
      createSyncNativeInstruction(adminWsolAccount.address)
    );
    wrapTx.feePayer = adminKp.publicKey;
    wrapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [adminKp]);
    console.log(`${wrapSig} migrateAuction => Wrapped SOL into WSOL`);

    //
    // calc how many tokens to deposit into the pool
    //
    // Option 1 ("underfund") / we use all the locked tokens
    const liquidityTokens = new BN(tokensWithdrawn.toString());
    const feeTokens = new BN(0); // TODO: extract same fee % for both tokens & sol (keep ratio unchanged for price)

    // Option 2 ("overmint") / V important! For whatever reason, we can't supply tokens leaving exactly zero in our account - raydium open position fails
    // so, move 99.9% of the ex fee amount
    // const originalTUnits = new BN(tokensWithdrawn.toString()).mul(new BN(1000)).div(new BN(1005)); // extract fee 0.5%: see place_bid.rs
    // console.log(`originalTUnits`, originalTUnits.toString());
    // const feeTokens = new BN(tokensWithdrawn.toString()).sub(originalTUnits);
    // const liquidityTokens = new BN(originalTUnits.toString()).mul(new BN(999)).div(new BN(1000)); // originalTUnits; //new BN(tokensWithdrawn.toString()).sub(feeTokens);
    // console.log(`tokensWithdrawn`, tokensWithdrawn.toString());
    // console.log(`originalTUnits`, originalTUnits.toString());
    // console.log(`feeTokens`, feeTokens.toString());
    // console.log(`liquidityTokens`, liquidityTokens.toString()); // T == S / P

    // Create & fund a new market/pool
    // const { marketId, poolId, marketInfo, poolKeys } = await createAndFundPool_v2_AMM(
    //   program, isMainnet, auctionId, tokenMint,
    //   BigInt(liquidityTokens.toString()),
    //   BigInt(liquidityWSol.toString()),
    //   adminKp, connection);
    const { poolId, poolKeys } = await createAndFundPool_v3_CLMM(
      program, isMainnet, auctionId, tokenMint,
      BigInt(liquidityTokens.toString()),
      BigInt(liquidityWSol.toString()),
      adminKp, connection, auctionDataFetched.clearingPrice.toNumber());

    console.log(`migrateAuction => OK!`);
    console.log(`tokenMint: ${tokenMint.toBase58()}`);
    console.log(`liquidityTokens: ${liquidityTokens.toString()}`);
    console.log(`liquidityWSol: ${liquidityWSol.toString()}`);
    //console.log(`marketInfo:`, marketInfo);
    //console.log(`marketId: ${marketId.toBase58()}`);
    console.log(`poolId: ${poolId.toBase58()}`);
    console.log(`poolKeys:`, poolKeys);

    // update DB
    await updateKeyPairPoolInfo(tokenMint, null /*marketInfo*/, poolKeys, null /*marketId*/, poolId);

    // Send fee tokens to the revenue wallet
    if (feeTokens.gt(new BN(0))) {
      const feeAccount = globalInfoAccount.config.feeAccount;
      const feeAccountTokenAccount = getAssociatedTokenAddressSync(tokenMint, feeAccount, true);
      const feeTx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(adminKp.publicKey, feeAccountTokenAccount, feeAccount, tokenMint, TOKEN_PROGRAM_ID),
        createTransferInstruction(
          adminTokenAccount,            // Source (admin's token account)
          feeAccountTokenAccount,       // Destination (feeAccount's ATA)
          adminKp.publicKey,            // Authority (admin)
          BigInt(feeTokens.toString()), // Amount (converted from BN to number)
          [],
          TOKEN_PROGRAM_ID
        ));
      feeTx.feePayer = adminKp.publicKey;
      feeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const feeSig = await sendAndConfirmTransaction(connection, feeTx, [adminKp]);
      await logSuccessTx(connection, feeSig, `migrateAuction (${auctionId}) => Sent fee tokens to the revenue wallet`);
    }
  }
  catch (error) {
    console.error(`migrateAuction (${auctionId}) => Error: ${error}`);
    throw error;
  }
};

async function withdrawFunds(program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, adminKp: Keypair, connection: Connection): Promise<{
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

  // Withdraw SOL
  const solBefore = BigInt(await connection.getBalance(auctionSol));
  console.log('calling withdrawSol...');
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
    .withdrawTokens()
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

// (2) Create market and pool - v3 CLMM (constant product pool; full range position)
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
  marketId: PublicKey; // not used by CLMM - returs null
  marketInfo: Object;  // not used by CLMM
}> {
  console.log(`createAndFundPool_v3_CLMM...`);
  const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });

  const mintAccount = await getMint(connection, tokenMint);
  const tokenDecimals = mintAccount.decimals;
  const initialPrice = new Decimal(auctionClearingPrice / LAMPORTS_PER_SOL);

  console.log(`createAndFundPool_v3_CLMM -> auctionClearingPrice`, auctionClearingPrice);
  console.log(`createAndFundPool_v3_CLMM -> initialPrice (SOL)`, initialPrice);

  console.log(`createAndFundPool_v3_CLMM -> wsolAmount (SOL)`, Number(wsolAmount.toString()) / LAMPORTS_PER_SOL);
  console.log(`createAndFundPool_v3_CLMM -> tokenAmount (tokens)`, Number(tokenAmount.toString()) / 10 ** tokenDecimals);

  const adminTokenAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, tokenMint, adminKp.publicKey);
  const adminWsolAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, WSOLMint, adminKp.publicKey);

  // check balances
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
  // logObject('getTokenMetadata...', tokenMint);
  // const metadata = await getTokenMetadata(connection, tokenMint);
  // logObject('metadata', metadata);
  // if (metadata && metadata.uri) {
  //   try {
  //     const response = await fetch(metadata.uri);
  //     const json = await response.json();
  //     console.log(`json`, json);
  //     logoURI = json.image || ''; // ERC-721 standard uses 'image' for logo URI    
  //   } catch (error) {
  //     console.error('Error fetching token metadata:', error);
  //   }
  // }
  // console.log(`logoURI`, logoURI);

  const tokenInfo: ApiV3Token = {
    chainId,
    address: tokenMint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    symbol: 'UNKNOWN',  //metadata ? metadata.symbol : 'UNKNOWN',
    name: 'Unknown Token', //metadata ? metadata.name : 'Unknown Token',
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

  // Create CLMM pool
  var clmmConfigs = isMainnet ? await raydium.api.getClmmConfigs() : clmmDevConfigs;
  const ammConfig = { ...clmmConfigs[0], id: new PublicKey(clmmConfigs[0].id), fundOwner: '', description: '' };
  const { execute: execCreatePool, extInfo: poolExtInfo } = await raydium.clmm.createPool({
    programId: clmmProgramId,
    mint1: tokenInfo, // Base token
    mint2: wsolInfo,  // Quote token (WSOL)
    ammConfig,
    initialPrice,
    txVersion: TxVersion.LEGACY,
  });
  const createPoolTx = await execCreatePool({ sendAndConfirm: true });
  console.log(`createAndFundPool_v3_CLMM -> ${createPoolTx.txId} createAndFundPool (${auctionId}) => Pool created`);
  const poolId = (poolExtInfo.address as any)["poolId"]; //poolExtInfo.address["poolId"];
  console.log(`createAndFundPool_v3_CLMM -> poolId`, poolId.toBase58());

  // Fetch pool info to get tick spacing
  const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const tickSpacing = (poolInfo.poolInfo as any)["tickSpacing"]; //const tickSpacing = poolInfo.poolInfo["tickSpacing"];

  // Set full range ticks
  const MIN_TICK = -443636;
  const MAX_TICK = 443636;
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  console.log(`createAndFundPool_v3_CLMM -> tickLower: ${tickLower}, tickUpper: ${tickUpper}`); 

  // Open full range liquidity position
  const baseAmount = new BN(tokenAmount.toString());
  const buffer = new BN(10); // Add a 10-lamport buffer: intermittent Program Error: "Instruction #3 Failed - custom program error: 6021 | Price slippage check"
  const otherAmountMax = new BN(wsolAmount.toString()).add(buffer);
  //const otherAmountMax = new BN(wsolAmount.toString());

  console.log(`createAndFundPool_v3_CLMM -> baseAmount`, Number(baseAmount.toString()) / 10 ** tokenDecimals);
  console.log(`createAndFundPool_v3_CLMM -> otherAmountMax`, Number(otherAmountMax.toString()) / LAMPORTS_PER_SOL);
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

  // test - get position info
  // await sleep(6);
  // const adminPositions = await raydium.clmm.getOwnerPositionInfo({ programId: DEVNET_PROGRAM_ID.CLMM });
  // //logObject("createAndFundPool_v3_CLMM -> adminPositions", adminPositions);
  // const position = adminPositions.find(pos => pos.poolId.toBase58() === poolId.toBase58());
  // if (!position) {
  //   console.log(`createAndFundPool_v3_CLMM -> Position not found for pool ${poolId.toBase58()}`);
  //   throw new Error('Position not found');
  // }
  // const priceLower = TickUtils.getTickPrice({ poolInfo: poolInfo.poolInfo, tick: position.tickLower, baseIn: true }).price.toNumber();
  // const priceUpper = TickUtils.getTickPrice({ poolInfo: poolInfo.poolInfo, tick: position.tickUpper, baseIn: true }).price.toNumber();
  // console.log(`createAndFundPool_v3_CLMM -> priceLower: ${priceLower} / priceUpper: ${priceUpper}`);

  // get pool price
  const poolInfoRpc = (await raydium.clmm.getRpcClmmPoolInfos({ poolIds: [poolId] }))[poolId];
  console.log(`createAndFundPool_v3_CLMM -> poolInfoRpc.currentPrice: ${poolInfoRpc.currentPrice} `);
  console.log(`createAndFundPool_v3_CLMM -> 1 / poolInfoRpc.currentPrice: ${1 / poolInfoRpc.currentPrice} `);
  console.log(`createAndFundPool_v3_CLMM -> initialPrice: ${initialPrice}`);
  if (Math.abs(initialPrice.toNumber() - 1 / poolInfoRpc.currentPrice) > 1e-6) {
    console.log(`createAndFundPool_v3_CLMM -> Current price mismatch`);
    throw new Error('Current price mismatch');
  }

  //logObject('createAndFundPool_v3_CLMM -> poolExtInfo', poolExtInfo);
  // const poolKeys = Object.keys(poolExtInfo.address).reduce(
  //   (acc, cur) => ({ ...acc, [cur]: poolExtInfo.address[cur].toBase58() }),
  //   {}
  // );
  return { poolId, poolKeys: poolExtInfo, marketInfo: {}, marketId: null };
}

// (2) OLD: Create market and pool - v2 AMM (continuous product pool)
async function createAndFundPool_v2_AMM(program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, tokenMint: PublicKey, tokenAmount: bigint, wsolAmount: bigint, adminKp: Keypair, connection: Connection): Promise<{
  marketId: PublicKey;
  poolId: PublicKey;
  marketInfo: Object;
  poolKeys: Object;
}> {
  const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });
  const mintAccount = await getMint(connection, tokenMint);
  const baseDecimals = mintAccount.decimals;

  // Create market
  console.log(`createAndFundPool -> raydium.marketV2.create: mintAccount ${tokenMint.toBase58()}, baseDecimals ${baseDecimals}...`);
  const { execute: execCM, extInfo: extInfoCM } = await raydium.marketV2.create({
    baseInfo: { mint: tokenMint, decimals: baseDecimals, },
    quoteInfo: { mint: WSOLMint, decimals: 9, }, // WSOL
    lotSize: 1, tickSize: 0.01,
    dexProgramId: isMainnet ? OPEN_BOOK_PROGRAM : DEVNET_PROGRAM_ID.OPENBOOK_MARKET,
    txVersion: TxVersion.LEGACY,
  });
  const cmSigs = await execCM({ sequentially: true });
  cmSigs.txIds.forEach(x => console.log(`createAndFundPool -> ${x} createAndFundPool (${auctionId}) => execCM OK`));
  const marketId = extInfoCM.address.marketId;
  const marketInfo = Object.keys(extInfoCM.address).reduce(
    (acc, cur) => ({ ...acc, [cur]: extInfoCM.address[cur as keyof typeof extInfoCM.address].toBase58(), }), {});

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
  console.log(`createAndFundPool -> baseAmount (tokens)`, baseAmount.toString());
  console.log(`createAndFundPool -> quoteAmount (lamports)`, quoteAmount.toString());
  if (baseAmount.mul(quoteAmount).lte(new BN(1).mul(new BN(10 ** baseMintInfo.decimals)).pow(new BN(2)))) { // need 1 sol for 1b tokens at 10^9 decimals
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
  console.log(`createAndFundPool -> ${cpSig} createAndFundPool (${auctionId}) => execCP OK`);
  const poolId = extInfoCP.address.ammId;
  const poolKeys = Object.keys(extInfoCP.address).reduce(
    (acc, cur) => ({ ...acc, [cur]: extInfoCP.address[cur as keyof typeof extInfoCP.address].toBase58(), }), {});

  return { marketId, poolId, marketInfo, poolKeys };
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
  //logObject("txDetails", txDetails);
  if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
    console.log("Transaction logs:", txDetails.meta.logMessages);
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

// https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/clmm/utils.ts
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