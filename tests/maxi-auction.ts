import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  ComputeBudgetProgram,
  AccountMeta,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  mintTo,
  getMint,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { MaxiAuction } from "../target/types/maxi_auction";
import keypair from "../id.json";
import { BN } from "bn.js";
import * as assert from "assert";
import logger from "node-color-log";
import {
  //connection,
  globalInfoSeed,
  auctionSolSeed,
  auctionDataSeed,
  TestBidQty1,
  TestBidQty2,
  TestBidQty3,
  TestBidQty4,
  TestBidQty5,
  TestBidSol1,
  TestBidSol2,
  TestBidSol3,
  TestBidSol4,
  TestBidSol5,
  TestDefaultLockPercent,
  TestHours,
  TestLockPercent,
  TestStartPriceSol,
  TestTokenDecimals,
  TestTokenName,
  //TestTokenQty,
  TestTokenSupply,
  TestTokenSymbol,
  TestTokenUri,
} from "./config";
import { createMarket } from "./create-market";
//import { DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk";

import { getOrCreateAssociatedTokenAccount, createSyncNativeInstruction } from '@solana/spl-token';
import { NATIVE_MINT } from '@solana/spl-token';
import { SystemProgram, } from '@solana/web3.js';

import { Raydium, TOKEN_WSOL } from '@raydium-io/raydium-sdk-v2';
import { RAYMint, USDCMint, OPEN_BOOK_PROGRAM, TxVersion, DEVNET_PROGRAM_ID, WSOLMint, USDTMint } from '@raydium-io/raydium-sdk-v2'
import { MARKET_STATE_LAYOUT_V3, AMM_V4, FEE_DESTINATION_ID, } from '@raydium-io/raydium-sdk-v2'
import { TRANSFER_SOURCE_INDEX } from "@project-serum/serum/lib/token-instructions";
import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmRpcData, } from '@raydium-io/raydium-sdk-v2'
import {  AMM_STABLE, } from '@raydium-io/raydium-sdk-v2'

import Decimal from 'decimal.js'
import { log } from "console";

var connection;
var isLocal = false;
var isDevnet = false;
var isMainnet = false;

// Recursively convert BN and PublicKey values
function convertValue(value) {
  if (value instanceof BN) {
    return value.toString(10); // BN to decimal string
  } else if (value instanceof PublicKey) {
    return value.toBase58(); // PublicKey to base58 string
  } else if (Array.isArray(value)) {
    return value.map(convertValue); // Handle arrays
  } else if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, convertValue(val)])
    ); // Handle objects
  }
  return value; // Leave other types as-is
}
function logObject(label, obj) {
  const convertedObj = convertValue(obj);
  console.log(label, convertedObj);
}

async function logSuccessTx(connection, sig, label) {
  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
  const status = await connection.getSignatureStatus(sig);
  console.log("TX status:", status);

  // Fetch transaction details
  const txDetails = await connection.getTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0
  });

  // Log the transaction signature
  logger.color("green").log(`>> ${label} << TX sig:`, sig);

  // Log the transaction logs if available
  logObject("txDetails", txDetails);
  console.log("txDetails", txDetails);
  if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
    console.log("Transaction logs:", txDetails.meta.logMessages);
  } else {
    console.log("No logs available for this transaction.");
  }
}

describe("maxi-auction", () => {
  // setup provider
  var providerEnv = anchor.AnchorProvider.env();
  anchor.setProvider(providerEnv);
  console.log("rpcEndpoint URL:", providerEnv.connection.rpcEndpoint);
  isLocal = providerEnv.connection.rpcEndpoint.indexOf("0.0.0.0") > -1;
  isDevnet = providerEnv.connection.rpcEndpoint.indexOf("devnet") > -1;
  isMainnet = isLocal == false && isDevnet == false;

  connection = providerEnv.connection;
  //console.log("connection", connection);
  const program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;

  // Listen for logs from your program
  connection.onLogs(
    program.programId,
    (logs) => {
      logs.logs.forEach((log) => {
        if (log.startsWith('Program log:')) {
          console.log('log:', log.replace('Program log: ', ''));
        }
      });
    },
    'finalized' // Wait for finalized logs to ensure reliability
  );

  // add listeners
  console.log("Setting up listeners...");

  program.addEventListener("auctionCreated", (event) => {
    logObject(">>> auctionCreated", event);
  });

  program.addEventListener("newBid", (event) => {
    logObject(">>> newBid", event);
  });

  program.addEventListener("bidCancelled", (event) => {
    logObject(">>> bidCancelled", event);
  });

  program.addEventListener("auctionFilled", async (event) => {
    logObject(">>> auctionFilled", event);
    const signer = adminKp;
    const auctionId = Number(event.auctionId.toString());
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionSol PDA
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionData PDA
    const auctionDataAccount = await program.account.auction.fetch(auctionData);
    logObject("auctionDataAccount", auctionDataAccount);

    const coinMint = new PublicKey(auctionDataAccount.tokenMint);
    const auctionTokenAccount = getAssociatedTokenAddressSync(coinMint, auctionSol, true); // Get auction token account
    const pcMint = new PublicKey("So11111111111111111111111111111111111111112"); // SOL mint address
    const ammProgram = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"); // Raydium AMM program
    const feeDestination = new PublicKey("FaodhCM6sEL3CGCKmcK6t6HVJXzjyrE8wHKRCrVFVX6h"); // ?
    const { marketAddress, dexAddress } = await createMarket(signer, coinMint, connection); // *** Create market ***
    const market = marketAddress;
    logObject("marketAddress", marketAddress);
    logObject("dexAddress", dexAddress);

    const [amm] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("amm_associated_seed")], ammProgram); // Derive AMM PDA
    const ammInfo = await connection.getAccountInfo(amm);
    if (ammInfo) { // DM - TODO: move this check up, before createMarket()...
      console.log("AMM pool already initialized, skipping migration");
      return;
    }
    else {
      console.log("AMM pool not initialized, migrating...");
    }

    const [ammAuthority] = PublicKey.findProgramAddressSync([Buffer.from("amm authority")], ammProgram); // Derive AMM authority PDA
    const [ammOpenOrders] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("open_order_associated_seed")], ammProgram); // Derive AMM open orders PDA
    const [coinVault] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("coin_vault_associated_seed")], ammProgram); // Derive coin vault PDA
    const [pcVault] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("pc_vault_associated_seed")], ammProgram); // Derive PC vault PDA
    console.log("pcVault: ", pcVault.toBase58());

    const [targetOrders] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("target_associated_seed")], ammProgram); // Derive target orders PDA
    console.log("targetOrders: ", targetOrders.toBase58()); // Log target orders

    const [ammConfig] = PublicKey.findProgramAddressSync([Buffer.from("amm_config_account_seed")], ammProgram); // Derive AMM config PDA
    const [lpMint] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("lp_mint_associated_seed")], ammProgram); // Derive LP mint PDA
    const userTokenCoin = await getAssociatedTokenAddress(coinMint, signer.publicKey, true); // Get user coin token account
    console.log("userTokenCoin: ", userTokenCoin.toBase58());

    const userTokenPc = await getAssociatedTokenAddress(pcMint, signer.publicKey, true); // Get user PC token account
    console.log("userTokenPc: ", userTokenPc.toBase58());

    const userTokenPcInfo = await connection.getAccountInfo(userTokenPc); // Check if the WSOL account exists
    if (!userTokenPcInfo) {
      console.log("Creating WSOL account...");
      // Create the WSOL ATA
      const createIx = createAssociatedTokenAccountInstruction(
        signer.publicKey, // Payer
        userTokenPc,      // ATA address
        signer.publicKey, // Owner
        pcMint            // Mint (WSOL)
      );
      const createTx = new Transaction().add(createIx);
      try {
        await sendAndConfirmTransaction(connection, createTx, [signer]);
      }
      catch (err) {
        console.log(err.toString());
        logger.color("red").log("createWSOL transaction signature", sig);
        logger.color("red").log("createWSOL failed:", err.getLogs());
        throw err;
      }
      console.log("WSOL account created at:", userTokenPc.toBase58());
    }

    const userTokenLp = await getAssociatedTokenAddress(lpMint, signer.publicKey, true); // Get user LP token account
    const nonce = 253; // Set nonce for AMM
    const openTime = new BN(Math.floor(Date.now() / 1000)); // Set pool open time
    const initPcAmount = new BN(0); // Set initial PC amount
    const initCoinAmount = new BN(0); // Set initial coin amount
    const tx = new Transaction(); // Create new transaction
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 })); // Set compute unit limit
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_200_000 })); // Set compute unit price
    tx.add(await program.methods.raydiumMigrate(nonce, openTime).accounts({
      auctionSolAccount: auctionSol,
      auctionDataAccount: auctionData,
      auctionTokenAccount,
      ammProgram,
      amm,
      ammAuthority,
      ammOpenOrders,
      ammLpMint: lpMint,
      ammCoinMint: coinMint,
      ammPcMint: pcMint,
      ammCoinVault: coinVault,
      ammPcVault: pcVault,
      ammTargetOrders: targetOrders,
      ammConfig,
      createFeeDestination: feeDestination,
      marketProgram: dexAddress,
      market,
      userWallet: signer.publicKey,
      userTokenCoin,
      userTokenPc,
      userTokenLp
    }).signers([signer]).transaction()); // Add raydiumMigrate instruction
    tx.feePayer = signer.publicKey; // Set fee payer
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash; // Set recent blockhash

    var sig;
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [signer]); // *** migrate raydium ***
    }
    catch (err) {
      console.log(err.toString());
      logger.color("red").log("raydiumMigrate transaction signature", sig);
      logger.color("red").log("raydiumMigrate failed:", err.getLogs());
      throw err;
    }
    logger.color("green").log("raydiumMigrate transaction signature", sig);
    await logSuccessTx(connection, sig, "raydiumMigrate");
  });

  program.addEventListener("claimed", (event) => {
    logObject(">>> claimed", event);
  });

  program.addEventListener("auctionMigrated", (event) => {
    logObject(">>> auctionMigrated", event);
  });

  const adminKp = Keypair.fromSecretKey(Uint8Array.from(keypair));

  const user1Kp = !isLocal ? adminKp : Keypair.generate(); // on devnet test admin does everything
  const user2Kp = !isLocal ? adminKp : Keypair.generate();
  const user3Kp = !isLocal ? adminKp : Keypair.generate();
  const user4Kp = !isLocal ? adminKp : Keypair.generate();
  const user5Kp = !isLocal ? adminKp : Keypair.generate();
  // const user6Kp = Keypair.generate();
  // const user7Kp = Keypair.generate();
  // const user8Kp = Keypair.generate();
  // const user9Kp = Keypair.generate();
  // const user10Kp = Keypair.generate();
  const tokenKp1 = Keypair.generate();
  const tokenKp2 = Keypair.generate();

  before(async () => {
    if (isLocal) {
      logger.color("blue").log("Airdropping SOL to accounts...");
      logger.color("green").log("Airdrop SOL to admin");
      const airdropTx = await connection.requestAirdrop(
        adminKp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx);
      logger.color("green").log("Airdrop SOL to user1");
      const airdropTx1 = await connection.requestAirdrop(
        user1Kp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx1);
      logger.color("green").log("Airdrop SOL to user2");
      const airdropTx2 = await connection.requestAirdrop(
        user2Kp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx2);
      logger.color("green").log("Airdrop SOL to user3");
      const airdropTx3 = await connection.requestAirdrop(
        user3Kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx3);
      logger.color("green").log("Airdrop SOL to user4");
      const airdropTx4 = await connection.requestAirdrop(
        user4Kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx4);
      logger.color("green").log("Airdrop SOL to user5");
      const airdropTx5 = await connection.requestAirdrop(
        user5Kp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx5);
    }
  });

  it("initializes the contract", async () => {
    await test_init();
  });

  it("creates an auction", async () => {
    await test_create_auction();
  });

  it("fills an auction", async () => {
    await test_bid_auction();
  });

  // Add the test to the suite
  it("cancels a bid", async () => {
    await test_cancel_bid();
  });  

  it("inits, creates & fills", async () => {
    await test_init();
    await test_create_auction();
    await test_bid_auction();
  });

  it("creates & interacts with a v2 pool", async () => {
    await test_create_pool_and_trade();
  });

  async function test_create_pool_and_trade() { // https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/amm
    const txVersion = TxVersion.LEGACY; // TxVersion.V0

    // **Step 1: Set up connection and keypairs && Initialize the Raydium SDK **
    const minterKp = adminKp; //Keypair.generate();
    const raydium = await Raydium.load({ connection, owner: minterKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });
    logger.color("green").log("Raydium SDK loaded");
  
    // Airdrop some SOL to the minter so we can fucking do stuff
    //const TEST_SOL = 1.0 * LAMPORTS_PER_SOL;
    //const airdropSig = await connection.requestAirdrop(minterKp.publicKey, TEST_SOL);
    //console.log(`Airdrop requested. Signature: ${airdropSig}`);
    //await connection.confirmTransaction(airdropSig);
    //const tx = await connection.getTransaction(airdropSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    //if (tx.meta.err) {
    //  throw new Error(`Airdrop failed: ${JSON.stringify(tx.meta.err)}`);
    //}
    //logger.color("green").log("Airdropped OK to AdminPk");
    //logger.color("green").log("Airdropped 1000 SOL to minter (adminKp)");
  
    // **Step 2: Mint a new fucking token**
    /*const tokenMint = await createMint(connection, minterKp, minterKp.publicKey, null, 9); // 9 decimals
    const minterTokenAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, tokenMint, minterKp.publicKey); // ATA
    const totalSupply = new BN(1_000_000).mul(new BN(10).pow(new BN(9))); // 1M tokens
    await mintTo(connection, minterKp, tokenMint, minterTokenAccount.address, minterKp, totalSupply.toNumber());
  
    // Check that the tokens are there
    const tokenBalance = await connection.getTokenAccountBalance(minterTokenAccount.address);
    assert.equal(tokenBalance.value.uiAmount, 1_000_000, "Minter should have 1M tokens, what the fuck");
    logger.color("green").log("Minted 1M tokens");
  
    // **Step 3: Wrap SOL into WSOL because pools need that shit**
    console.log('TOKEN_WSOL.address', TOKEN_WSOL.address); // So11111111111111111111111111111111111111112
    const minterWsolAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, new PublicKey(TOKEN_WSOL.address), minterKp.publicKey);
    //const minterWsolAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, NATIVE_MINT, minterKp.publicKey);
    const solToWrap = TEST_SOL / 10;
    console.log('solToWrap', solToWrap);
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: minterKp.publicKey,
        toPubkey: minterWsolAccount.address,
        lamports: solToWrap,
      }),
      createSyncNativeInstruction(minterWsolAccount.address)
    );
    wrapTx.feePayer = minterKp.publicKey;
    wrapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [minterKp]);
    await logSuccessTx(connection, wrapSig, "Wrapped minter's SOL into WSOL");
  
      // 4b - create a market
      console.log('WSOLMint', WSOLMint.toBase58());
      console.log('tokenMint', tokenMint.toBase58());
      //console.log('RAYMint', RAYMint.toBase58());
      //console.log('USDCMint', USDCMint.toBase58());
      var { execute: execCM, extInfo: extInfoCM, transactions: txsCM } = await raydium.marketV2.create({
        baseInfo: {
          // create market doesn't support token 2022
          mint: tokenMint, //RAYMint,
          decimals: 9,
        },
        quoteInfo: {
          // create market doesn't support token 2022
          mint: WSOLMint, //USDCMint, //new PublicKey(TOKEN_WSOL.address), //USDCMint,
          decimals: 9,
        },
        lotSize: 1,
        tickSize: 0.01,
        //dexProgramId: OPEN_BOOK_PROGRAM, // MAINNET
         dexProgramId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET, // devnet
    
        // requestQueueSpace: 5120 + 12, // optional
        // eventQueueSpace: 262144 + 12, // optional
        // orderbookQueueSpace: 65536 + 12, // optional
    
        txVersion,
        // optional: set up priority fee here
        // computeBudgetConfig: {
        //   units: 600000,
        //   microLamports: 46591500,
        // },
      })

      const marketInfo = Object.keys(extInfoCM.address).reduce(
        (acc, cur) => ({ ...acc, [cur]: extInfoCM.address[cur as keyof typeof extInfoCM.address].toBase58(), }), {} );
      console.log(`create market total ${txsCM.length} txs, market info: `, marketInfo);
      const marketId = new PublicKey(marketInfo['marketId']);
      console.log('marketId', marketId.toBase58());
      const txIds = await execCM({ sequentially: true, });
      await logSuccessTx(connection, wrapSig, "Create market");
      // TODO: save marketInfo
  
    // **Step 5: Create a fucking pool**
    const marketBufferInfo = await raydium.connection.getAccountInfo(new PublicKey(marketId));
    console.log('marketBufferInfo', marketBufferInfo);
    const { baseMint, quoteMint } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo!.data);
    const baseMintInfo = await raydium.token.getTokenInfo(baseMint);
    const quoteMintInfo = await raydium.token.getTokenInfo(quoteMint);
    console.log('baseMintInfo', baseMintInfo);
    console.log('quoteMintInfo', quoteMintInfo);
    console.log('TOKEN_PROGRAM_ID', TOKEN_PROGRAM_ID.toBase58());
    if(baseMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58() || quoteMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58()) {
      throw new Error('baseMint or quoteMint is not a supported token type');
    }
    
    const baseAmount = new BN(1000).mul(new BN(10).pow(new BN(9))); // 1K tokens
    const quoteAmount = new BN(1).mul(new BN(10).pow(new BN(8))); // 0.1 SOL (1 sol = 1 ^ 9 decimals)
    if (baseAmount.mul(quoteAmount).lte(new BN(1).mul(new BN(10 ** baseMintInfo.decimals)).pow(new BN(2)))) {
      throw new Error('initial liquidity too low, try adding more baseAmount/quoteAmount');
    }
  
    const { execute: execCP, extInfo: extInfoCP, } = await raydium.liquidity.createPoolV4({
      //programId: AMM_V4, // MAINNET
      programId: DEVNET_PROGRAM_ID.AmmV4, // devnet

      marketInfo: {
        marketId,
        //programId: OPEN_BOOK_PROGRAM, // MAINNET
        programId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET, // devent
      },
      baseMintInfo: {
        mint: baseMint,
        decimals: baseMintInfo.decimals, // if you know mint decimals here, can pass number directly
      },
      quoteMintInfo: {
        mint: quoteMint,
        decimals: quoteMintInfo.decimals, // if you know mint decimals here, can pass number directly
      },
      baseAmount, //: new BN(1000),
      quoteAmount, //: new BN(1000),
  
      // sol devnet faucet: https://faucet.solana.com/
      // baseAmount: new BN(4 * 10 ** 9), // if devent pool with sol/wsol, better use amount >= 4*10**9
      // quoteAmount: new BN(4 * 10 ** 9), // if devent pool with sol/wsol, better use amount >= 4*10**9
  
      startTime: new BN(0), // unit in seconds
      ownerInfo: {
        useSOLBalance: true,
      },
      associatedOnly: false,
      txVersion,
      
      //feeDestinationId: FEE_DESTINATION_ID, // MAINNET
      feeDestinationId: DEVNET_PROGRAM_ID.FEE_DESTINATION_ID, // devnet
      
      // optional: set up priority fee here
      // computeBudgetConfig: {
      //   units: 600000,
      //   microLamports: 4659150,
      // },
    });
    const { txId } = await execCP({ sendAndConfirm: true })
    const poolKeys = Object.keys(extInfoCP.address).reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: extInfoCP.address[cur as keyof typeof extInfoCP.address].toBase58(),
      }),
      {}
    );
    console.log('amm pool created! txId: ', txId, ', poolKeys:', poolKeys);*/
    // TODO: save poolKeys

    // ======
    const poolKeys = { // 55DNHgNJyDRBDSivTyRPxwxKQ2iWGYwFX1jrmSeNy216xpyPFXFkXzLjmWTCZDkmsC47ZmYUq79G3tq9miJK3nQn
      programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
      ammId: '84dpFz4AmxDcZG9DaSaYemCaeE9Y1yW53cvyuBiZ5dDW',
      ammAuthority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
      ammOpenOrders: 'HFHQdDMatVpsHbDoRM2wvdvihx4n9Nw9jxphtRLBkzET',
      lpMint: '4uSHTqUBZ4dBviDb7qzpJCnMprBMFRAXmEBXdJsn2RtK',
      coinMint: 'Ca64LeCxBmo2b6cTJ9d3pmC8guUrWfsmMfa31eHb2PHM',
      pcMint: 'So11111111111111111111111111111111111111112',
      coinVault: 'ASr4deV1u8jVPzMMfKPCADwd1TV3hJRmHE5HnUtEv6gc',
      pcVault: 'H9GujaG4UHwqNRqZNXsVo4qssS9noMwJLcBaLCBAxqZf',
      withdrawQueue: '9Nj4h51E68Tk6c4uuBY51WKZSKBE5FUpdrzrwMRnfvay',
      ammTargetOrders: 'FKgXLurwrZptVyAAAHUQ9PiixpKQQpk2wnEybQ3rgM63',
      poolTempLp: 'F9yVPDLLjcmoZag3yZEeRJWwhq1ekPkwYAm1bUjhs6zb',
      marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
      marketId: '5FsJuTdjAj8CGEd8n9uWiARg4JZaATzaBYW9MCXGQjN3',
      ammConfigId: '8QN9yfKqWDoKjvZmqFsgCzAqwZBQuzVVnC388dN5RCPo',
      feeDestinationId: '3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR'
    };
  
    // **Step 6: Query the damn pool price**
    const poolId = poolKeys.ammId;
    const poolInfos = await raydium.liquidity.getRpcPoolInfos([poolId]);
    const poolInfo = poolInfos[poolId];
    logObject('poolInfo', poolInfo);
    const price = new Decimal(poolInfo.quoteReserve.toString()).div(poolInfo.baseReserve.toString()).toNumber();
    logger.color("green").log(`Reserve ratios: ${price} WSOL per token`);
    logger.color("green").log(`poolInfo.poolPrice: ${poolInfo.poolPrice} WSOL per token`);
  
    //
    // **Step 7: Buy some tokens (swap SOL for tokens)**
    //
    const amountIn = 0.01 * 10 ** 9; // 0.01 WSOL
    const inputMint = poolInfo.quoteMint.toBase58(); // WSOL??  //NATIVE_MINT.toBase58();
    //const poolId = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2' // SOL-USDC pool
    let poolInfo2: ApiV3PoolInfoStandardItem | undefined;
    let poolKeys2: AmmV4Keys | undefined;
    let rpcData: AmmRpcData;
    if (isMainnet) {
      // note: api doesn't support get devnet pool info, so in devnet else we go rpc method
      // if you wish to get pool info from rpc, also can modify logic to go rpc method directly
      const data = await raydium.api.fetchPoolById({ ids: poolId });
      poolInfo2 = data[0] as ApiV3PoolInfoStandardItem;
      if (!isValidAmm(poolInfo2.programId)) throw new Error('target pool is not AMM pool');
      poolKeys2 = await raydium.liquidity.getAmmPoolKeys(poolId);
      rpcData = await raydium.liquidity.getRpcPoolInfo(poolId);
    } else {
      // note: getPoolInfoFromRpc method only return required pool data for computing not all detail pool info
      const data = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
      poolInfo2 = data.poolInfo;
      poolKeys2 = data.poolKeys;
      rpcData = data.poolRpcData;
    }
    // TODO: save poolInfo2 and poolKeys2 (more info than poolInfo and poolKeys?)
    //assert.equal(poolInfo2, poolInfo, 'poolInfo2 should be equal to poolInfo');
    //assert.equal(poolKeys2, poolKeys, 'poolKeys2 should be equal to poolKeys');
    const [baseReserve, quoteReserve, status] = [rpcData.baseReserve, rpcData.quoteReserve, rpcData.status.toNumber()];
    if (poolInfo2.mintA.address !== inputMint && poolInfo2.mintB.address !== inputMint) throw new Error('input mint does not match pool')

    const baseIn = inputMint === poolInfo2.mintA.address
    console.log('baseIn', baseIn);
    const [mintIn, mintOut] = baseIn ? [poolInfo2.mintA, poolInfo2.mintB] : [poolInfo2.mintB, poolInfo2.mintA]
    console.log('mintIn', mintIn.address);
    console.log('mintOut', mintOut.address);
    const out = raydium.liquidity.computeAmountOut({
      poolInfo: {
        ...poolInfo2,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountIn: new BN(amountIn),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: 0.01, // range: 1 ~ 0.0001, means 100% ~ 0.01%
    })
    console.log(
      `computed swap ${new Decimal(amountIn)
        .div(10 ** mintIn.decimals)
        .toDecimalPlaces(mintIn.decimals)
        .toString()} ${mintIn.symbol || mintIn.address} to ${new Decimal(out.amountOut.toString())
        .div(10 ** mintOut.decimals)
        .toDecimalPlaces(mintOut.decimals)
        .toString()} ${mintOut.symbol || mintOut.address}, minimum amount out ${new Decimal(out.minAmountOut.toString())
        .div(10 ** mintOut.decimals)
        .toDecimalPlaces(mintOut.decimals)} ${mintOut.symbol || mintOut.address}`
    );

    const { execute } = await raydium.liquidity.swap({
      poolInfo: poolInfo2,
      poolKeys: poolKeys2,
      amountIn: new BN(amountIn),
      amountOut: out.minAmountOut, // out.amountOut means amount 'without' slippage
      fixedSide: 'in',
      inputMint: mintIn.address,
      txVersion,
      // optional: set up token account
      // config: {
      //   inputUseSolBalance: true, // default: true, if you want to use existed wsol token account to pay token in, pass false
      //   outputUseSolBalance: true, // default: true, if you want to use existed wsol token account to receive token out, pass false
      //   associatedOnly: true, // default: true, if you want to use ata only, pass true
      // },
      // optional: set up priority fee here
      // computeBudgetConfig: {
      //   units: 600000,
      //   microLamports: 46591500,
      // },
      // optional: add transfer sol to tip account instruction. e.g sent tip to jito
      // txTipConfig: {
      //   address: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
      //   amount: new BN(10000000), // 0.01 sol
      // },
    });
  
    // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
    const { txId: swapTx1Id } = await execute({ sendAndConfirm: true });
    const SwapTx1 = await connection.getTransaction(swapTx1Id, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (SwapTx1.meta.err) {
      throw new Error(`SwapTx1 failed: ${JSON.stringify(SwapTx1.meta.err)}`);
    }
    console.log(`swap successfully in amm pool:`, { txId: `${swapTx1Id}` });

    /*const solToSpend = new BN(1).mul(new BN(10).pow(new BN(9))); // 1 SOL
    const expectedTokensOut = await raydium.cpmm.computeAmountOut({
      poolId,
      amountIn: solToSpend,
      mintIn: TOKEN_WSOL.mint,
      mintOut: tokenMint,
      slippage: 0.01, // 1% slippage
    });
    const minTokensOut = expectedTokensOut.minAmountOut;
    const { execute: buyExecute } = await raydium.cpmm.swap({
      poolId,
      amountIn: solToSpend,
      minAmountOut: minTokensOut,
      mintIn: TOKEN_WSOL.mint,
      mintOut: tokenMint,
      payer: minterKp.publicKey,
    });
    const buySig = await buyExecute();
    await logSuccessTx(connection, buySig, "buy tokens");
  
    // **Step 8: Sell some tokens (swap tokens for SOL)**
    const tokensToSell = new BN(1000).mul(new BN(10).pow(new BN(9))); // 1000 tokens
    const expectedSolOut = await raydium.cpmm.computeAmountOut({
      poolId,
      amountIn: tokensToSell,
      mintIn: tokenMint,
      mintOut: TOKEN_WSOL.mint,
      slippage: 0.01, // 1% slippage
    });
    const minSolOut = expectedSolOut.minAmountOut;
    const { execute: sellExecute } = await raydium.cpmm.swap({
      poolId,
      amountIn: tokensToSell,
      minAmountOut: minSolOut,
      mintIn: tokenMint,
      mintOut: TOKEN_WSOL.mint,
      payer: minterKp.publicKey,
    });
    const sellSig = await sellExecute();
    await logSuccessTx(connection, sellSig, "sell tokens");
  
    logger.color("green").log("Test case completed, fuck yeah!");*/
  }
  const VALID_PROGRAM_ID = new Set([
    AMM_V4.toBase58(),
    AMM_STABLE.toBase58(),
    DEVNET_PROGRAM_ID.AmmV4.toBase58(),
    DEVNET_PROGRAM_ID.AmmStable.toBase58(),
  ]);
  const isValidAmm = (id: string) => VALID_PROGRAM_ID.has(id);

  async function test_init() {
    logger.color("magenta").log("*** Initializing the auction system...");
    const signer = adminKp;

    console.log("Program ID in test:", program.programId.toBase58());
    console.log("signer.publicKey:", signer.publicKey.toBase58());
    console.log("connection.rpcEndpoint", connection.rpcEndpoint);

    const newConfig = {
      admin: adminKp.publicKey, //new PublicKey("7Q823wjwGC5X78XLb1QeFABtkwSP17ytHhqneCPC8aYL"),
      defaultTokenSupply: new BN(TestTokenSupply),
      defaultTokenDecimals: TestTokenDecimals,
      defaultStartPriceLamports: new BN(TestStartPriceSol * LAMPORTS_PER_SOL),
      defaultLockPercent: new BN(TestDefaultLockPercent),
    };
    const [globalInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from(globalInfoSeed)],
      program.programId
    );
    const tx = await program.methods
      .initialize(newConfig)
      .accounts({
        signer: signer.publicKey,
      })
      .signers([signer])
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    try {
      const simulationResult = await connection.simulateTransaction(tx);
      console.log("Simulation result:", simulationResult);
      if (simulationResult.value.err) {
        console.dir('simulationResult.value.err', simulationResult.value.err);
        throw new Error(`Simulation failed: ${simulationResult.value.err.toString()}`);
      }

      var sig;
      try {
        sig = await sendAndConfirmTransaction(connection, tx, [signer]);
      } catch (err) {
        logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs());
        throw err;
      }
      logger.color("green").log("Your transaction signature", sig);

      const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
      logger.color("green").log("globalInfoAccount", globalInfoAccount);
      const { deployer, config, auctionsNum } = globalInfoAccount;

      console.log("\n");
      console.log("deployer", deployer.toString());
      console.log("signer.publicKey", signer.publicKey.toString());
      assert.equal(deployer.toString(), signer.publicKey.toString());

      //console.log("auctionsNum", auctionsNum, "auctionsNum expected 0");
      //assert.equal(auctionsNum, 0);

      console.log("\n");
      console.log("config.defaultTokenSupply", config.defaultTokenSupply.toString());
      console.log("TestTokenSupply", TestTokenSupply);
      assert.equal(parseFloat(config.defaultTokenSupply.toString()), TestTokenSupply);

      console.log("\n");
      console.log("config.defaultTokenDecimals", config.defaultTokenDecimals.toString());
      console.log("TestTokenDecimals", TestTokenDecimals);
      assert.equal(parseFloat(config.defaultTokenDecimals.toString()), TestTokenDecimals);

      console.log("\n");
      console.log("config.defaultLockPercent", config.defaultLockPercent.toString());
      console.log("TestDefaultLockPercent", TestDefaultLockPercent);
      assert.equal(parseFloat(config.defaultLockPercent.toString()), TestDefaultLockPercent);

      console.log("\n");
      console.log("config.defaultStartPriceLamports", config.defaultStartPriceLamports.toNumber());
      console.log("Math.round(TestStartPriceSol * LAMPORTS_PER_SOL)", Math.round(TestStartPriceSol * LAMPORTS_PER_SOL));

      //assert.equal(config.defaultStartPriceLamports.toNumber(), Math.round(TestStartPriceSol * LAMPORTS_PER_SOL), "Start price in lamports should match");
      //assert.equal(parseFloat(config.defaultStartPriceLamports.toString()), TestStartPriceSol * LAMPORTS_PER_SOL);

      console.log("\n");
      console.log("config.defaultLockPercent", config.defaultLockPercent.toString());
      console.log("TestDefaultLockPercent", TestDefaultLockPercent);
      assert.equal(parseFloat(config.defaultLockPercent.toString()), TestDefaultLockPercent);

    } catch (e) {
      console.error("Transaction error:", e);
      if (e.logs) {
        console.error("Transaction logs:", e.logs);
      }
      throw e;
    }
  }

  async function test_create_auction() {
    logger.color("magenta").log("User1 is creating auction...");
    const [globalInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from(globalInfoSeed)],
      program.programId
    );

    const signer = user1Kp;
    const token = tokenKp1;

    const xId = new BN(42);
    const name = TestTokenName;
    const symbol = TestTokenSymbol;
    const uri = TestTokenUri;
    const durationHours = new BN(10); // about 5mins: unit is actually hours_div_100, or 36s 
    const lockPercent = new BN(TestLockPercent); //TestLockPercent;
    const delaySeconds = new BN(0);

    // Log balances of all signing accounts before the transaction
    const [adminBalance, signerBalance, tokenBalance] = await Promise.all([
      connection.getBalance(adminKp.publicKey),
      connection.getBalance(signer.publicKey),
      connection.getBalance(token.publicKey),
    ]);
    console.log("Balances before creating auction (in SOL):");
    console.log(`Admin (${adminKp.publicKey.toBase58()}): ${(adminBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Signer (${signer.publicKey.toBase58()}): ${(signerBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Token mint (${token.publicKey.toBase58()}): ${(tokenBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    const tx = await program.methods
      .createAuction(xId, name, symbol, uri, durationHours, lockPercent, delaySeconds)
      .accounts({
        creator: signer.publicKey,
        admin: adminKp.publicKey,
        tokenMint: token.publicKey,
      })
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // try {
    // console.log("*** simulateTransaction createAuction", await connection.simulateTransaction(tx));
    // }
    // catch (error) {
    //   console.error("Error during transaction signing or confirmation:", error);
    //   if (error instanceof Error && "getLogs" in error) {
    //     const logs = await error.getLogs;
    //     console.error("Simulation logs:", logs);
    //   }
    //   throw error;
    // }
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer, token]);
      logger.color("green").log("createAuction transaction signature:", sig);
    }
    catch (err) {
      console.error("Error during transaction signing or confirmation:", err);
      if (err instanceof Error && "getLogs" in err) {
        const logs = await err.getLogs;
        console.error("logs:", logs);
      }
      throw err;
    }

    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    console.log("auctionId", auctionId);

    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),], program.programId);
    console.log("auctionData", auctionData);

    const auctionDataFetched = await program.account.auction.fetch(auctionData);
    logObject("auctionDataFetched", auctionDataFetched);

    // auction num
    //assert.equal(globalInfoAccount.auctionsNum, 1);

    // auction states
    assert.equal(parseFloat(auctionDataFetched.id.toString()), auctionId);
    assert.equal(auctionDataFetched.isFinished, false);
    assert.equal(auctionDataFetched.creator, signer.publicKey.toBase58());

    //const startTimestamp = parseFloat(auctionDataFetched.startTimestamp.toString());
    //const endTimestamp = parseFloat(auctionDataFetched.endTimestamp.toString());
    //assert.equal(endTimestamp - startTimestamp, TestHours * 36 /* hours_div_100 lol*/, "duration comparison");

    assert.equal(auctionDataFetched.tokenMint, token.publicKey.toBase58(), "tokenMint comparison");
  }

  async function test_bid_auction(fill_percent: number = 1.0) { // BID ALL SUPPLY by default
    await test_create_auction();
    logger.color("magenta").log("User2 is bidding...");

    // Derive program-derived addresses
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    console.log("auctionId", auctionId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    console.log("auctionSol", auctionSol.toBase58());
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    console.log("auctionData", auctionData.toBase58());

    // Fetch auction data before the bid
    const auctionPre = await program.account.auction.fetch(auctionData);
    logObject("auctionPre", auctionPre);

    const signer = user2Kp;
    console.log("signer (user2Kp)", signer.publicKey.toBase58());
    const bidQty = new BN(auctionPre.tokenSupply.toNumber() / (Math.pow(10, auctionPre.tokenDecimals)) * fill_percent);
    console.log("tokenSupply", auctionPre.tokenSupply.toString());
    console.log("bidQty", bidQty.toString());

    // Fetch initial balances
    const bidderBalanceBefore = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceBefore = await connection.getBalance(auctionSol);
    console.log("Balances before placing bid (in SOL):");
    console.log(`Bidder (${signer.publicKey.toBase58()}): ${(bidderBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Auction SOL account (${auctionSol.toBase58()}): ${(auctionSolBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    // Construct and send the transaction
    const tx = await program.methods
      .placeBid(bidQty, new BN(42))
      .accounts({
        bidder: signer.publicKey,
        auctionDataAccount: auctionData,
        auctionSolAccount: auctionSol,
      })
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    let sig;
    try {
      sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer]);
      await logSuccessTx(connection, sig, "placeBid");
    } catch (err) {
      console.error("logs:", await err.getLogs());
      throw err;
    }
    logger.color("green").log("placeBid transaction signature", sig);

    // Fetch final balances and auction data after the bid
    const bidderBalanceAfter = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceAfter = await connection.getBalance(auctionSol);
    const auctionPost = await program.account.auction.fetch(auctionData);
    logObject("auctionDataFetched_After", auctionPost);

    // Fetch transaction fee
    const txDetails = await connection.getTransaction(sig, { commitment: 'confirmed' });
    const fee = txDetails.meta.fee;

    // Calculate expected amount transferred
    const lastBid = auctionPost.bids[0];
    const bidQtyFetched = lastBid.bidQty;
    const bidSol = lastBid.bidSol; // Price per whole token in lamports
    const decimals = auctionPost.tokenDecimals;
    const expectedAmount = bidQtyFetched/*.div(new BN(10).pow(new BN(decimals)))*/.mul(bidSol);

    // Convert balances to BN for precise arithmetic
    const bidderBalanceBeforeBN = new BN(bidderBalanceBefore);
    const bidderBalanceAfterBN = new BN(bidderBalanceAfter);
    const auctionSolBalanceBeforeBN = new BN(auctionSolBalanceBefore);
    const auctionSolBalanceAfterBN = new BN(auctionSolBalanceAfter);
    const feeBN = new BN(fee);

    // Assertions
    assert.equal(auctionPost.bids.length, 1, "bid length comparison");

    console.log("auctionSolBalanceBeforeBN", auctionSolBalanceBeforeBN.toString());
    console.log("auctionSolBalanceAfterBN", auctionSolBalanceAfterBN.toString());
    console.log("expectedAmount", expectedAmount.toString());
    assert.equal(
      auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).eq(expectedAmount),
      true,
      "auctionSol balance increase should match expected amount"
    );
    assert.equal(
      bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).eq(expectedAmount.add(feeBN)),
      true,
      "bidder balance decrease should match expected amount plus fee"
    );

    // Logging results
    console.log("\nBid Validation Results:");
    console.log(`Expected SOL spent for the bid: ${(expectedAmount.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Actual auction SOL balance increase: ${(auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Actual bidder balance decrease: ${(bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Transaction fee: ${(feeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  }

  async function test_cancel_bid() {
    console.log("Testing cancel_bid function...");

    // Place a bid for 50% of the auction using the existing test_fill_auction function
    await test_bid_auction(0.5); // Bids for 50% of token supply 
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1; // Latest auction ID
    console.log("Auction ID:", auctionId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),], program.programId);

    // Fetch auction data to confirm the bid exists
    const auctionDataBefore = await program.account.auction.fetch(auctionData);
    logObject("auctionDataBefore", auctionDataBefore);

    console.log("user2Kp.publicKey", user2Kp.publicKey.toBase58());
    const bid = auctionDataBefore.bids.find(b => b.bidder.equals(user2Kp.publicKey));
    console.log("bid", bid);
    assert.strictEqual(bid != undefined, true, "Bid should exist before cancellation");
    const totalBidAmount = bid.bidQty.mul(bid.bidSol).toNumber(); // Total SOL spent (in lamports)
    console.log("totalBidAmount ", (totalBidAmount / anchor.web3.LAMPORTS_PER_SOL).toFixed(6));

    // Capture the bidder's balance before cancellation
    const balanceBefore = await connection.getBalance(user2Kp.publicKey);
    //console.log(`Bidder balance before cancel: ${(balanceBefore / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Cancel the bid
    const cancelTx = await program.methods
      .cancelBid()
      .accounts({
        caller: user2Kp.publicKey,
        auctionSolAccount: auctionSol,
        auctionDataAccount: auctionData,
      })
      .transaction();
    cancelTx.feePayer = user2Kp.publicKey;
    cancelTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    let cancelSig;
    try {
      cancelSig = await sendAndConfirmTransaction(connection, cancelTx, [user2Kp]);
      await logSuccessTx(connection, cancelSig, "cancelBid");
    } catch (err) {
      console.error("logs:", await err.getLogs);
      throw err;
    }
    logger.color("green").log("cancelBid transaction signature", cancelSig);
    const txDetails = await connection.getTransaction(cancelSig, { commitment: 'confirmed' });
    const fee = txDetails.meta.fee;
    console.log(`Cancellation transaction fee: ${fee} lamports`);

    const fetched = await program.account.auction.fetch(auctionData);
    logObject("fetched", fetched);

    // Capture the bidder's balance after cancellation
    const balanceAfter = await connection.getBalance(user2Kp.publicKey);
    //console.log(`Bidder balance after cancel: ${(balanceAfter / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Calculate the expected balance
    console.log('balanceBefore', balanceBefore);
    console.log('balanceAfter', balanceAfter);
    console.log('fee', fee);

    console.log('totalBidAmount', totalBidAmount); //

    const expectedBalance = balanceBefore + totalBidAmount - fee;
    console.log(`Expected balance: ${expectedBalance} lamports`);
    console.log(`Actual balance: ${balanceAfter} lamports`);

    // Assert exact equality
    assert.strictEqual(
      balanceAfter,
      expectedBalance,
      `Balance after cancellation should be exactly balanceBefore + totalBidAmount - fee: expected ${expectedBalance}, got ${balanceAfter}`
    );

    // Fetch auction data to confirm the bid is removed
    const auctionDataAfter = await program.account.auction.fetch(auctionData);
    assert.equal(auctionDataAfter.bids.length, 0, "Bid list should be empty after cancellation");
  }

  it("creates a market", async () => {
    logger.color("magenta").log("admin is creating a market...");

    const [adminBalance_before,] = await Promise.all([connection.getBalance(adminKp.publicKey),]);
    console.log(`adminBalance_before (${adminKp.publicKey.toBase58()}): ${(adminBalance_before / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    const signer = adminKp;
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionSol PDA
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionData PDA
    const auctionDataAccount = await program.account.auction.fetch(auctionData);
    logObject("auctionDataAccount", auctionDataAccount);

    const coinMint = new PublicKey(auctionDataAccount.tokenMint);
    logObject("coinMint", coinMint);
    // const auctionTokenAccount = getAssociatedTokenAddressSync(coinMint, auctionSol, true); // Get auction token account
    // const pcMint = new PublicKey("So11111111111111111111111111111111111111112"); // SOL mint address
    // const ammProgram = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"); // Raydium AMM program
    // const feeDestination = new PublicKey("FaodhCM6sEL3CGCKmcK6t6HVJXzjyrE8wHKRCrVFVX6h"); // ?
    const market = await createMarket(signer, coinMint, connection);
    logObject("market", market);

    const [adminBalance_after,] = await Promise.all([connection.getBalance(adminKp.publicKey),]);
    console.log(`adminBalance_after (${adminKp.publicKey.toBase58()}): ${(adminBalance_after / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  });

  it("test getMint", async () => {
    const connection = new Connection("https://api.devnet.solana.com", "finalized");
    const mintAddress = new PublicKey("3qm3Vvv8kpgRnyN3Us5tvz3R3QMpocGqN98xuKS3PFja");
    try {
      console.log('connection.rpcEndpoint', connection.rpcEndpoint);
      const mintInfo = await getMint(connection, mintAddress, "finalized", TOKEN_PROGRAM_ID);
      console.log("Mint Info:", {
        supply: mintInfo.supply.toString(),
        decimals: mintInfo.decimals,
        isInitialized: mintInfo.isInitialized,
        mintAuthority: mintInfo.mintAuthority?.toBase58() || "None",
        freezeAuthority: mintInfo.freezeAuthority?.toBase58() || "None",
      });
    } catch (error) {
      console.error("Error fetching mint:", error.message);
    }
  });


  // it("User3 is bidding", async () => {
  //   logger.color("magenta").log("User3 is bidding...");
  //   const signer = user3Kp;
  //   const bidQty = new BN(TestBidQty2);
  //   const bidSol = new BN(TestBidSol2 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const tx = await program.methods
  //     .placeBid(bidQty, bidSol)
  //     .accounts({
  //       bidder: signer.publicKey,
  //       auctionDataAccount: auctionData,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // console.log(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const auctionDataAccount = await program.account.auction.fetch(auctionData);

  //   // auction states
  //   assert.equal(auctionDataAccount.bids.length, 2, "bid length comparison");
  // });

  // it("User4 made a bid, but it failed because the balance was exceeded", async () => {
  //   logger
  //     .color("magenta")
  //     .log(
  //       "User4 made a bid, but it failed because the balance was exceeded..."
  //     );
  //   const signer = user4Kp;
  //   const bidQty = new BN(TestBidQty3 * 10 ** TestTokenDecimals);
  //   const bidSol = new BN(TestBidSol3 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   try {
  //     const tx = await program.methods
  //       .placeBid(bidQty, bidSol)
  //       .accounts({
  //         bidder: signer.publicKey,
  //         auctionDataAccount: auctionData,
  //         auctionSolAccount: auctionSol,
  //       })
  //       .signers([signer])
  //       .transaction();

  //     tx.feePayer = signer.publicKey;
  //     tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //     // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //     await sendAndConfirmTransaction(connection, tx, [signer]);
  //     throw new Error(
  //       "Bidding should have failed with exceeded balance but succeeded."
  //     );
  //   } catch (error) {
  //     logger.color("red").log("Expected failure occurred:", error.message);
  //   }
  // });

  // it("User3 canceled bid", async () => {
  //   logger.color("magenta").log("User3 canceled bid...");
  //   const signer = user3Kp;

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const tx = await program.methods
  //     .cancelBid()
  //     .accounts({
  //       caller: signer.publicKey,
  //       auctionDataAccount: auctionData,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const auctionDataAccount = await program.account.auction.fetch(auctionData);

  //   // auction states
  //   assert.equal(auctionDataAccount.bids.length, 1, "bid length comparison");
  // });

  // it("User4 made a bid again", async () => {
  //   logger.color("magenta").log("User4 made a bid again...");
  //   const signer = user4Kp;
  //   const bidQty = new BN(TestBidQty3);
  //   const bidSol = new BN(TestBidSol3 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const tx = await program.methods
  //     .placeBid(bidQty, bidSol)
  //     .accounts({
  //       bidder: signer.publicKey,
  //       auctionDataAccount: auctionData,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const auctionDataAccount = await program.account.auction.fetch(auctionData);

  //   // auction states
  //   assert.equal(auctionDataAccount.bids.length, 2, "bid length comparison");
  // });

  // it("User5 made a bid", async () => {
  //   logger.color("magenta").log("User5 made a bid...");
  //   const signer = user5Kp;
  //   const bidQty = new BN(TestBidQty4);
  //   const bidSol = new BN(TestBidSol4 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const tx = await program.methods
  //     .placeBid(bidQty, bidSol)
  //     .accounts({
  //       bidder: signer.publicKey,
  //       auctionDataAccount: auctionData,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const auctionDataAccount = await program.account.auction.fetch(auctionData);

  //   // auction states
  //   assert.equal(auctionDataAccount.bids.length, 3, "bid length comparison");
  // });

  // it("User2 is claiming tokens from the auction", async () => {
  //   logger.color("magenta").log("User2 is claiming tokens from the auction...");
  //   const signer = user2Kp;
  //   const token = tokenKp1;

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSolSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [auctionData] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionDataSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const auctionTokenAccount = getAssociatedTokenAddressSync(
  //     token.publicKey,
  //     auctionSol,
  //     true
  //   );

  //   const tx = new Transaction();
  //   tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
  //   tx.add(
  //     ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_200_000 })
  //   );
  //   tx.add(
  //     await program.methods
  //       .claim()
  //       .accounts({
  //         caller: signer.publicKey,
  //         tokenMint: token.publicKey,
  //         auctionSolAccount: auctionSol,
  //         auctionDataAccount: auctionData,
  //         auctionTokenAccount,
  //       })
  //       .signers([signer])
  //       .transaction()
  //   );

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);
  // });

  // it("User4 is creating auction!", async () => {
  //   logger.color("magenta").log("User4 is creating auction...");
  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );

  //   logger.color("blue").log(tokenKp2.publicKey.toBase58());

  //   const signer = user4Kp;
  //   const token = tokenKp2;
  //   const userTokenAccount = getAssociatedTokenAddressSync(
  //     token.publicKey,
  //     signer.publicKey
  //   );

  //   const prevUserTokenBalance = await connection.getTokenAccountBalance(
  //     userTokenAccount
  //   );
  //   // logger.color('gray').log(("prevUserTokenBalance", prevUserTokenBalance.value.uiAmount));

  //   const name = TestTokenName;
  //   const symbol = TestTokenSymbol;
  //   const uri = TestTokenUri;
  //   const decimals = TestTokenDecimals;
  //   const supply = new BN(TestTokenSupply);
  //   const durationHours = new BN(TestHours);
  //   const lockPercent = 69;

  //   const tx = await program.methods
  //     .createAuction(
  //       name,
  //       symbol,
  //       uri,
  //       decimals,
  //       supply,
  //       durationHours,
  //       lockPercent
  //     )
  //     .accounts({
  //       caller: signer.publicKey,
  //       tokenMint: token.publicKey,
  //     })
  //     .signers([signer])
  //     .transaction();
  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  //   // console.log(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature:", sig);

  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );
  //   logger.color("blue").log("globalInfoAccount:", globalInfoAccount);
  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const postUserTokenBalance = await connection.getTokenAccountBalance(
  //     userTokenAccount
  //   );

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const auctionTokenAccount = getAssociatedTokenAddressSync(
  //     token.publicKey,
  //     auctionSol,
  //     true
  //   );
  //   const postAuctionTokenBalance = await connection.getTokenAccountBalance(
  //     auctionTokenAccount
  //   );

  //   const auctionSolAccount = await program.account.auction.fetch(auctionSol);

  //   // auction num
  //   assert.equal(auctionId, 1);

  //   // token balances
  //   assert.equal(
  //     prevUserTokenBalance.value.uiAmount - postUserTokenBalance.value.uiAmount,
  //     TestTokenQty,
  //     "user token balance comparison"
  //   );
  //   assert.equal(
  //     postAuctionTokenBalance.value.uiAmount,
  //     TestTokenQty,
  //     "auction token balance comparison"
  //   );

  //   // auction states
  //   assert.equal(parseFloat(auctionSolAccount.id.toString()), auctionId);
  //   assert.equal(auctionSolAccount.isFinished, false);
  //   assert.equal(auctionSolAccount.creator, signer.publicKey.toBase58());

  //   const startTimestamp = parseFloat(
  //     auctionSolAccount.startTimestamp.toString()
  //   );
  //   //.color('tartTimestamp').log logger("startTimestamp", startTimestamp);
  //   const endTimestamp = parseFloat(auctionSolAccount.endTimestamp.toString());
  //   //.color('ndTimestamp').log logger("endTimestamp", endTimestamp);
  //   assert.equal(
  //     endTimestamp - startTimestamp,
  //     TestHours * 3600,
  //     "duration comparison"
  //   );
  //   assert.equal(
  //     auctionSolAccount.tokenMint,
  //     token.publicKey.toBase58(),
  //     "tokenMint comparison"
  //   );
  //   assert.equal(auctionSolAccount.isLocked, false);
  // });

  // it("User4 is bidding the auction", async () => {
  //   logger.color("magenta").log("User4 is bidding the auction...");
  //   const signer = user4Kp;
  //   const bidQty = new BN(TestBidQty2 * 10 ** TestTokenDecimals);
  //   const bidSol = new BN(TestBidSol2 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [globalSolAccount] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalSolAccountSeed)],
  //     program.programId
  //   );

  //   const prevGlobalSolBalance = await connection.getBalance(globalSolAccount);
  //   //.color('revGlobalSolBalance').log logger("prevGlobalSolBalance", prevGlobalSolBalance);

  //   const tx = await program.methods
  //     .placeBid(bidQty, bidSol)
  //     .accounts({
  //       bidder: signer.publicKey,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  //   // logge.color('connection').logr(await connection.simulateTransaction(tx));

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const postGlobalSolBalance = await connection.getBalance(globalSolAccount);
  //   //.color('ostGlobalSolBalance').log logger("postGlobalSolBalance", postGlobalSolBalance);

  //   const auctionSolAccount = await program.account.auction.fetch(auctionSol);
  //   //.color('uctionSolAccount').log logger("auctionSolAccount", auctionSolAccount);

  //   // sol balances
  //   assert.equal(
  //     (postGlobalSolBalance - prevGlobalSolBalance) / LAMPORTS_PER_SOL,
  //     TestBidQty2 * TestBidSol2,
  //     "sol balance comparison"
  //   );

  //   // auction states
  //   assert.equal(auctionSolAccount.bids.length, 2, "bid length comparison");
  // });

  // it("User1 is bidding the auction", async () => {
  //   logger.color("magenta").log("User1 is bidding the auction...");
  //   const signer = user1Kp;
  //   const bidQty = new BN(TestBidQty1 * 10 ** TestTokenDecimals);
  //   const bidSol = new BN(TestBidSol1 * LAMPORTS_PER_SOL);

  //   const [globalInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalInfoSeed)],
  //     program.programId
  //   );
  //   const globalInfoAccount = await program.account.globalInfo.fetch(
  //     globalInfo
  //   );

  //   const auctionId = Number(globalInfoAccount.auctionsNum) - 1;

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from(auctionSeed),
  //       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );

  //   const [globalSolAccount] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(globalSolAccountSeed)],
  //     program.programId
  //   );

  //   const prevGlobalSolBalance = await connection.getBalance(globalSolAccount);
  //   //.color('revGlobalSolBalance').log logger("prevGlobalSolBalance", prevGlobalSolBalance);

  //   const tx = await program.methods
  //     .placeBid(bidQty, bidSol)
  //     .accounts({
  //       bidder: signer.publicKey,
  //       auctionSolAccount: auctionSol,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const postGlobalSolBalance = await connection.getBalance(globalSolAccount);
  //   //.color('ostGlobalSolBalance').log logger("postGlobalSolBalance", postGlobalSolBalance);

  //   const auctionSolAccount = await program.account.auction.fetch(auctionSol);
  //   //.color('uctionSolAccount').log logger("auctionSolAccount", auctionSolAccount);

  //   // sol balances
  //   assert.equal(
  //     (postGlobalSolBalance - prevGlobalSolBalance) / LAMPORTS_PER_SOL,
  //     TestBidQty2 * TestBidSol2,
  //     "sol balance comparison"
  //   );

  //   // auction states
  //   assert.equal(auctionSolAccount.bids.length, 2, "bid length comparison");
  // });

  // it("User4 is claiming bid from the auction2", async () => {
  //   logger.color("magenta").log("User4 is claiming bid from the auction2...");

  //   const signer = user4Kp;
  //   const token = tokenKp2;

  //   const user4TokenAccount = getAssociatedTokenAddressSync(
  //     token.publicKey,
  //     signer.publicKey
  //   );

  //   const [auctionSol] = PublicKey.findProgramAddressSync(
  //     [Buffer.from(auctionSeed), new anchor.BN(1).toArrayLike(Buffer, "le", 8)],
  //     program.programId
  //   );

  //   const auctionTokenAccount = getAssociatedTokenAddressSync(
  //     token.publicKey,
  //     auctionSol,
  //     true
  //   );

  //   const tx = await program.methods
  //     .claim()
  //     .accounts({
  //       caller: signer.publicKey,
  //       callerTokenAccount: user4TokenAccount,
  //       auctionSolAccount: auctionSol,
  //       auctionTokenAccount: auctionTokenAccount,
  //     })
  //     .signers([signer])
  //     .transaction();

  //   tx.feePayer = signer.publicKey;
  //   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  //   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  //   logger.color("green").log("Your transaction signature", sig);

  //   const auctionSolAccount = await program.account.auction.fetch(auctionSol);
  //   logger.color("blue").log("auctionSolAccount", auctionSolAccount);
  // });
});

// program.addEventListener("auctionFilled", async (event) => {
//   logObject(">>> auctionFilled", event);
//   const signer = adminKp;
//   const auctionId = Number(event.auctionId.toString());

//   const [auctionSol] = PublicKey.findProgramAddressSync(
//     [
//       Buffer.from(auctionSolSeed),
//       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
//     ],
//     program.programId
//   );

//   const [auctionData] = PublicKey.findProgramAddressSync(
//     [
//       Buffer.from(auctionDataSeed),
//       new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),
//     ],
//     program.programId
//   );

//   const auctionDataAccount = await program.account.auction.fetch(auctionData);
//   logObject("auctionDataAccount", auctionDataAccount);

//   const coinMint = new PublicKey(auctionDataAccount.tokenMint);
//   const auctionTokenAccount = getAssociatedTokenAddressSync(
//     coinMint,
//     auctionSol,
//     true
//   );

//   //  pc mint address
//   const pcMint = new PublicKey("So11111111111111111111111111111111111111112");

//   const ammProgram = new PublicKey(
//     "HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"
//   );

//   const feeDestination = new PublicKey(
//     "FaodhCM6sEL3CGCKmcK6t6HVJXzjyrE8wHKRCrVFVX6h"
//   );

//   const market = await createMarket(signer, coinMint, connection);
//   console.log("market : ", market);

//   const [amm] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("amm_associated_seed"),
//     ],
//     ammProgram
//   );
//   const [ammAuthority] = PublicKey.findProgramAddressSync(
//     [Buffer.from("amm authority")],
//     ammProgram
//   );
//   const [ammOpenOrders] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("open_order_associated_seed"),
//     ],
//     ammProgram
//   );
//   const [coinVault] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("coin_vault_associated_seed"),
//     ],
//     ammProgram
//   );

//   const [pcVault] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("pc_vault_associated_seed"),
//     ],
//     ammProgram
//   );
//   console.log("pcVault: ", pcVault.toBase58());

//   const [targetOrders] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("target_associated_seed"),
//     ],
//     ammProgram
//   );
//   console.log("targetOrders: ", targetOrders.toBase58());

//   const [ammConfig] = PublicKey.findProgramAddressSync(
//     [Buffer.from("amm_config_account_seed")],
//     ammProgram
//   );

//   const [lpMint] = PublicKey.findProgramAddressSync(
//     [
//       ammProgram.toBuffer(),
//       market.toBuffer(),
//       Buffer.from("lp_mint_associated_seed"),
//     ],
//     ammProgram
//   );

//   const userTokenCoin = await getAssociatedTokenAddress(
//     coinMint,
//     signer.publicKey,
//     true
//   );
//   console.log("userTokenCoin: ", userTokenCoin.toBase58());

//   const userTokenPc = await getAssociatedTokenAddress(
//     pcMint,
//     signer.publicKey,
//     true
//   );

//   console.log("userTokenPc: ", userTokenPc.toBase58());

//   const userTokenLp = await getAssociatedTokenAddress(
//     lpMint,
//     signer.publicKey,
//     true
//   );

//   const nonce = 253;
//   const openTime = new BN(Math.floor(Date.now() / 1000));
//   const initPcAmount = new BN(0);
//   const initCoinAmount = new BN(0);

//   const tx = new Transaction();
//   tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
//   tx.add(
//     ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_200_000 })
//   );
//   tx.add(
//     await program.methods
//       .raydiumMigrate(nonce, openTime)
//       .accounts({
//         auctionSolAccount: auctionSol,
//         auctionDataAccount: auctionData,
//         auctionTokenAccount,
//         ammProgram,
//         amm,
//         ammAuthority,
//         ammOpenOrders,
//         ammLpMint: lpMint,
//         ammCoinMint: coinMint,
//         ammPcMint: pcMint,
//         ammCoinVault: coinVault,
//         ammPcVault: pcVault,
//         ammTargetOrders: targetOrders,
//         ammConfig,
//         createFeeDestination: feeDestination,
//         market,
//         userWallet: signer.publicKey,
//         userTokenCoin,
//         userTokenPc,
//         userTokenLp,
//       })
//       .signers([signer])
//       .transaction()
//   );
//   tx.feePayer = signer.publicKey;
//   tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
//   const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
//   logger.color("green").log("raydiumMigrate transaction signature", sig);
// });