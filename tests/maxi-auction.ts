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
//import { createMarket } from "./create-market";

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

import { migrateAuction } from "./migrate-auction"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import "dotenv/config";
import * as sql from "mssql";

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

var connection;
var isLocal = false;
var isDevnet = false;
var isMainnet = false;

// 12MhCcaTUtiG86K5ahiAmYSZ4Z9VCsxUKSTcAQjimaxi
const TEST_FEE_ACCOUNT = Keypair.fromSecretKey(bs58.decode("4hbfT4t6HZtcBVUq983nHXnXs7KdQXxrNUdkCVPaNYT82qSd3hH7eVJkgVicHX9MtatidQuEi3E5nXJ5UbE9ExHp"));

const auctionFilledPromises = new Map();

describe("maxi-auction", () => {
  // setup provider
  var providerEnv = anchor.AnchorProvider.env();
  anchor.setProvider(providerEnv);
  console.log("rpcEndpoint URL:", providerEnv.connection.rpcEndpoint);
  isLocal = providerEnv.connection.rpcEndpoint.indexOf("0.0.0.0") > -1;
  isDevnet = providerEnv.connection.rpcEndpoint.indexOf("devnet") > -1;
  isMainnet = isLocal == false && isDevnet == false;
  console.log("isLocal", isLocal);
  console.log("isDevnet", isDevnet);
  console.log("isMainnet", isMainnet);

  connection = providerEnv.connection;
  //console.log("connection", connection);
  const program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;

  // Listen for logs from your program
  connection.onLogs(program.programId, (logs) => {
      logs.logs.forEach((log) => {
        if (log.startsWith('Program log:')) {
          console.log('log:', log.replace('Program log: ', ''));
        }
      });
    }, 'finalized'
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

  /*program.addEventListener("auctionFilled", async (event) => {
    logObject(">>> auctionFilled", event);

    const signer = adminKp;
    const auctionId = Number(event.auctionId.toString());
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionSol PDA
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId); // Derive auctionData PDA
    const auctionDataAccount = await program.account.auction.fetch(auctionData);
    logObject("auctionDataAccount", auctionDataAccount);

    await migrateAuction(program, isMainnet, auctionId, adminKp, connection); // ok???
  });*/

  program.addEventListener("auctionFilled", async (event) => {
    logObject(">>> auctionFilled", event);

    if (isLocal) {
      console.log("auctionFilled event received on local network: NOP, no raydium here...");
    }
    else {
      const signer = adminKp;
      const auctionId = Number(event.auctionId.toString());
      const [auctionSol] = PublicKey.findProgramAddressSync(
        [Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [auctionData] = PublicKey.findProgramAddressSync(
        [Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const auctionDataAccount = await program.account.auction.fetch(auctionData);
      logObject("auctionDataAccount", auctionDataAccount);

      // Process migration and resolve the promise
      await migrateAuction(program, isMainnet, auctionId, adminKp, connection).then(() => {
        const resolve = auctionFilledPromises.get(auctionId);
        if (resolve) {
          resolve(); // Signal that migration is complete
          auctionFilledPromises.delete(auctionId); // Clean up the Map
        }
      });
    }
  });

  program.addEventListener("claimed", (event) => {
    logObject(">>> claimed", event);
  });

  program.addEventListener("auctionMigrated", (event) => {
    logObject(">>> auctionMigrated", event);
  });

  // setup fixed admin keypair, and new random user keypairs
  const adminKp = Keypair.fromSecretKey(Uint8Array.from(keypair));
  const USER_KPs = [];
  for (var i = 0; i < 5; i++) {
    USER_KPs[i] = !isLocal ? adminKp : Keypair.generate(); // on devnet test admin does everything
  }
  const user1Kp = USER_KPs[0];
  const user2Kp = USER_KPs[1];
  const user3Kp = USER_KPs[2];
  const user4Kp = USER_KPs[3];
  const user5Kp = USER_KPs[4];

  //var tokenKp1;

  before(async () => {
    // get a maxi keypair from DB
    //tokenKp1 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();
    //tokenKp2 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();

    if (isLocal) {
      logger.color("blue").log("Airdropping SOL to accounts...");
      logger.color("green").log("Airdrop SOL to admin");

      const airdropPromises = USER_KPs.map(account => {
        return connection.requestAirdrop(account.publicKey, 5 * LAMPORTS_PER_SOL)
          .then(tx => {
            console.log('airdropping admin +', account.publicKey.toBase58());
            return tx;
          });
      });
      airdropPromises.push(connection.requestAirdrop(adminKp.publicKey, 5 * LAMPORTS_PER_SOL));
      const airdropTxs = await Promise.all(airdropPromises);
      const confirmPromises = airdropTxs.map(tx => connection.confirmTransaction(tx));
      await Promise.all(confirmPromises);

      /*logger.color("green").log("Airdrop SOL to user1");
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
      await connection.confirmTransaction(airdropTx5);*/
    }
  });

  it("initializes the contract", async () => {
    await test_init();
  });

  it("creates an auction", async () => {
    await test_create_auction();
  });

  it("places a bid", async () => {
    await test_create_auction();
    await test_bid_auction(0.1);
  });

  it("cancels a bid", async () => {
    await test_create_auction();
    await test_bid_auction(0.5); // Bids for 50% of token supply 
    await test_cancel_bid();
  });  

  it("same user places two bids", async () => {
    await test_create_auction();
    await test_bid_auction(0.1);
    await test_bid_auction(0.1);
  });  

  it("fills an auction", async () => {
    await test_create_auction();
    await test_bid_auction();
  });

  it("filled auction does not allow new bids", async () => {
    if (isLocal) {
      await test_create_auction();
      await test_bid_auction(0.5);
      await test_bid_auction(0.5); // fill auction
      try {
        await test_bid_auction(0.1); // must fail
      }
      catch (err) {
        assert.equal(err.toString().includes("Not enough tokens"), true, "Contract error was expected.");
        console.log("Expected Error: ", err);
      }
    }
    else {
      const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
      const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
      const auctionId = 3; // auction id 3 - liq. moved...
      const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const auctionDataFetched = await program.account.auction.fetch(auctionData);
      const tokenMint = auctionDataFetched.tokenMint;
      const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true);

      const auctionSolBalance = await connection.getBalance(auctionSol);
      const auctionTokenBalance = BigInt(await connection.getTokenAccountBalance(auctionTokenAccount).value.amount);

      // bids > 0, balances all 0 means liq. moved -- enforce in SC on bid... (reject bid?)
      //throw ("TODO"); // want good behavior after liq. is moved and user tries to bid...
    }
  });

  it("creates & interacts with a v2 pool", async () => {
    await test_create_pool_and_trade();
  });

  it("admin withdraws after 1 bid", async () => {
    await test_admin_withdraws();
  });

  it("admin withdraws after 2 distinct bids", async () => {
    await test_admin_withdraws(2);
  });

  it("allows bidders to claim in full & admin to setup v2 pool", async () => {
    
    // TODO... multiple bids, + claim + pool setup -- expect zero left in contract....

    // TODO: save pool & market info to DB...

    // TODO: fees & costs for pool setup... who pays when auction doesn't have much sol?

    // TODO: fees - redirect (two new "revenue" wallets) 1% sol, 0.1% tokens before pool setup?

  });

  async function test_admin_withdraws(n_bids = 1) {
    // Step 1: Create an auction and place bid(s) to populate the auction with SOL and tokens
    await test_create_auction();
    for (var i = 0; i < n_bids; i++) {
      const kp = USER_KPs[i % USER_KPs.length];
      await test_bid_auction(0.5 / n_bids, kp); // Bid up to half supply
    }
  
    logger.color("magenta").log("Admin is withdrawing SOL and tokens...");
  
    // Step 2: Derive necessary accounts
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    console.log("auctionId", auctionId);
  
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],program.programId);
  
    const auctionDataFetched = await program.account.auction.fetch(auctionData);
    const tokenMint = auctionDataFetched.tokenMint;
    const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true); // Allow off-curve for PDA
    const adminTokenAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, tokenMint,  adminKp.publicKey);
  
    // Step 3: Fetch balances before withdrawal
    const adminSolBefore = await connection.getBalance(adminKp.publicKey);
    const auctionSolBefore = await connection.getBalance(auctionSol);
  
    const auctionTokenBalanceBefore = await connection.getTokenAccountBalance(auctionTokenAccount);
    const auctionTokenBefore = BigInt(auctionTokenBalanceBefore.value.amount); // Use integer amount for precision
  
    const adminTokenBalanceBefore = await connection.getTokenAccountBalance(adminTokenAccount.address);
    const adminTokenBefore = BigInt(adminTokenBalanceBefore.value.amount); // Use integer amount for precision
  
    // Fetch lockPercent and calculate expected withdrawal
    const lockPercent = auctionDataFetched.lockPercent.toNumber(); // Convert BN to number (1 to 1000)
    console.log(`lockPercent: ${lockPercent}`);
  
    const amountToWithdraw = (auctionTokenBefore * BigInt(lockPercent)) / BigInt(1000); // Calculate tokens to withdraw
    const expectedAuctionTokenAfter = auctionTokenBefore - amountToWithdraw; // Remaining tokens in auction
    const expectedAdminTokenAfter = adminTokenBefore + amountToWithdraw; // Admin's new balance
    console.log(`amountToWithdraw: ${amountToWithdraw.toString()}`);
    console.log(`expectedAuctionTokenAfter: ${expectedAuctionTokenAfter.toString()}`);
    console.log(`expectedAdminTokenAfter: ${expectedAdminTokenAfter.toString()}`);
  
    // Step 4: Withdraw SOL
    const callAs = adminKp;
    try {
      const txSol = await program.methods
        .withdrawSol()
        .accounts({
          admin: callAs.publicKey,
          auctionDataAccount: auctionData,
          auctionSolAccount: auctionSol,
        })
        .signers([callAs])
        .rpc();
      logger.color("green").log("withdrawSol transaction signature:", txSol);
      await logSuccessTx(connection, txSol, "withdrawSol");
    } catch (err) {
      console.error(err.toString());
      console.error("logs:", await err.getLogs());
      throw err;
    }
  
    // Step 5: Withdraw Tokens
    try {
      const txTokens = await program.methods
        .withdrawTokens()
        .accounts({
          admin: callAs.publicKey,
          auctionDataAccount: auctionData,
          auctionSolAccount: auctionSol,
          auctionTokenAccount: auctionTokenAccount,
          adminTokenAccount: adminTokenAccount.address,
        })
        .signers([callAs])
        .rpc();
      logger.color("green").log("withdrawTokens transaction signature:", txTokens);
      await logSuccessTx(connection, txTokens, "txTokens");
    } catch (err) {
      console.error(err.toString());
      console.error("logs:", await err.getLogs());
      throw err;
    }
  
    // Step 6: Fetch balances after withdrawal
    const adminSolAfter = await connection.getBalance(adminKp.publicKey);
    const auctionSolAfter = await connection.getBalance(auctionSol);
  
    const auctionTokenBalanceAfter = await connection.getTokenAccountBalance(auctionTokenAccount);
    const auctionTokenAfter = BigInt(auctionTokenBalanceAfter.value.amount);
  
    const adminTokenBalanceAfter = await connection.getTokenAccountBalance(adminTokenAccount.address);
    const adminTokenAfter = BigInt(adminTokenBalanceAfter.value.amount);
  
    // Step 7: Log balances for debugging
    console.log("Balances before withdrawal:");
    console.log(`Admin SOL: ${(adminSolBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Auction SOL: ${(auctionSolBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Auction Tokens: ${auctionTokenBefore.toString()} tokens`);
    console.log(`Admin Tokens: ${adminTokenBefore.toString()} tokens`);
  
    console.log("Balances after withdrawal:");
    console.log(`Admin SOL: ${(adminSolAfter / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Auction SOL: ${(auctionSolAfter / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
    console.log(`Auction Tokens: ${auctionTokenAfter.toString()} tokens`);
    console.log(`Admin Tokens: ${adminTokenAfter.toString()} tokens`);
  
    // Step 8: Assertions
    // SOL assertions remain unchanged
    assert.equal(auctionSolAfter, 0, "Auction SOL account should be empty after withdrawal");
    assert.equal(adminSolAfter > adminSolBefore, true, "Admin SOL should increase after withdrawal");
  
    // Token assertions updated for partial withdrawal
    assert.equal(
      auctionTokenAfter.toString(),
      expectedAuctionTokenAfter.toString(),
      "Auction token account should have the remaining tokens after withdrawal"
    );
    assert.equal(
      adminTokenAfter.toString(),
      expectedAdminTokenAfter.toString(),
      "Admin token balance should increase by the withdrawn amount"
    );
  }

  async function test_create_pool_and_trade() { // https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/amm
    if (isLocal) {
      logger.color("yellow").log("Skipping pool creation on localnet");
      return;
    }
    const txVersion = TxVersion.LEGACY; // TxVersion.V0

    // **Step 1: Set up connection and keypairs && Initialize the Raydium SDK **
    const minterKp = adminKp; //Keypair.generate();
    const raydium = await Raydium.load({ connection, owner: minterKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });
    logger.color("green").log("Raydium SDK loaded");
  
    // Airdrop some SOL to the minter so we can fucking do stuff
    const TEST_SOL = 1.0 * LAMPORTS_PER_SOL;
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
    const tokenMint = await createMint(connection, minterKp, minterKp.publicKey, null, 9); // 9 decimals
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
    console.log('amm pool created! txId: ', txId, ', poolKeys:', poolKeys);
    // TODO: save poolKeys to DB table, index by auctionId

    // test poolkeys - ignore
    /*const poolKeys = { // 55DNHgNJyDRBDSivTyRPxwxKQ2iWGYwFX1jrmSeNy216xpyPFXFkXzLjmWTCZDkmsC47ZmYUq79G3tq9miJK3nQn
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
    };*/
  
    // **Step 6: Query the damn pool price**
    const poolId = poolKeys['ammId'];
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
    // const SwapTx1 = await connection.getTransaction(swapTx1Id, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const SwapTx1 = await getTransactionDetailsWithRetry(connection, swapTx1Id);
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
      //defaultLockPercent: new BN(TestDefaultLockPercent),
      feeAccount: TEST_FEE_ACCOUNT.publicKey,
    };
    logObject("newConfig", newConfig);

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

      const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo); // ###
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

      // console.log("\n");
      // console.log("config.defaultLockPercent", config.defaultLockPercent.toString());
      // console.log("TestDefaultLockPercent", TestDefaultLockPercent);
      // assert.equal(parseFloat(config.defaultLockPercent.toString()), TestDefaultLockPercent);

      console.log("\n");
      console.log("config.defaultStartPriceLamports", config.defaultStartPriceLamports.toNumber());
      console.log("Math.round(TestStartPriceSol * LAMPORTS_PER_SOL)", Math.round(TestStartPriceSol * LAMPORTS_PER_SOL));

      console.log("\n");
      console.log("newConfig.feeAccount", newConfig.feeAccount.toBase58());

      //assert.equal(config.defaultStartPriceLamports.toNumber(), Math.round(TestStartPriceSol * LAMPORTS_PER_SOL), "Start price in lamports should match");
      //assert.equal(parseFloat(config.defaultStartPriceLamports.toString()), TestStartPriceSol * LAMPORTS_PER_SOL);

    } catch (e) {
      console.error("Transaction error:", e);
      if (e.logs) {
        console.error("Transaction logs:", e.logs);
      }
      throw e;
    }
  }

  async function test_create_auction(auction_lock_percent = undefined) { // 0-1
    logger.color("magenta").log("User1 is creating auction...");
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoTest = await program.account.globalInfo.fetchNullable(globalInfo);
    if (!globalInfoTest) throw ("Global Info not initialized!");
    const signer = user1Kp;

    // use a real ...maxi keypair if we're running e2e on devnet/mainnet
    const tokenKp1 = isLocal ? Keypair.generate() : Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey()));
    const token = tokenKp1;

    // test auction data
    const xId = new BN(42);
    const name = TestTokenName;
    const symbol = TestTokenSymbol;
    const uri = TestTokenUri;
    const durationHours = new BN(10); // about 5mins: unit is actually hours_div_100, or 36s 
    const lockPercent = new BN(auction_lock_percent * 1000 || TestLockPercent); 
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
    console.log(`lockPercent: ${lockPercent.toNumber()/10} %`);

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

    try {
      console.log("*** simulateTransaction createAuction", await connection.simulateTransaction(tx));
    }
    catch (error) {
      console.error("Error during transaction signing or confirmation:", error);
      if (error instanceof Error && "getLogs" in error) {
        const logs = await error.getLogs;
        console.error("Simulation logs:", logs);
      }
      throw error;
    }

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

    await markMaxiKeyUsed(token.publicKey.toBase58());

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

  async function test_bid_auction(fill_percent = 1.0, bidderKp = user2Kp) { // Bid all supply by default, lock 10% for AMM
    logger.color("magenta").log(`${bidderKp.publicKey} is bidding...`);

    // Derive PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    console.log("auctionId", auctionId, "auctionSol", auctionSol.toBase58(), "auctionData", auctionData.toBase58());

    // Fetch pre-bid auction data
    const auctionPre = await program.account.auction.fetch(auctionData);
    logObject("auctionPre", auctionPre);

  // Set up bidder and bid quantity
    const signer = bidderKp;
    const bidQty = new BN(auctionPre.tokenSupply.toNumber() / Math.pow(10, auctionPre.tokenDecimals) * fill_percent);
    console.log("signer", signer.publicKey.toBase58(), "tokenSupply", auctionPre.tokenSupply.toString(), "bidQty", bidQty.toString());

    // Get initial balances
    const bidderBalanceBefore = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceBefore = await connection.getBalance(auctionSol);
    const feeAccountBalanceBefore = await connection.getBalance(TEST_FEE_ACCOUNT.publicKey); // Initial fee account balance
    console.log(`Balances before bid: Bidder (${signer.publicKey.toBase58()}): ${(bidderBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL, Auction (${auctionSol.toBase58()}): ${(auctionSolBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL, Fee Account: ${(feeAccountBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    // Check if bid fills auction
    const totalBidTokens = auctionPre.bids.reduce((acc, bid) => {
      return acc.add(bid.bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals))));
    }, new BN(0));
    const remainingTokens = auctionPre.tokenSupply.sub(totalBidTokens);
    const bidQtyLamports = bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals)));
    const isFinalBid = bidQtyLamports.gte(remainingTokens);
    console.log('remainingTokens:', remainingTokens.toString());
    console.log('bidQtyLamports:', bidQtyLamports.toString());
    console.log('isFinalBid:', isFinalBid);

    // **Step 1: Add event listener for NewBid event**
    let actualBidFeeBN;
    const listener = program.addEventListener("newBid", (event) => {
      actualBidFeeBN = new BN(event.bidFee);
      console.log("Captured bid fee from event:", actualBidFeeBN.toString());
    });

    // Place bid transaction
    const tx = await program.methods.placeBid(bidQty, new BN(42))
      .accounts({
        bidder: signer.publicKey,
        auctionDataAccount: auctionData,
        auctionSolAccount: auctionSol,
        feeAccount: TEST_FEE_ACCOUNT.publicKey
      })
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer]).catch(err => {
      console.error("logs:", err.getLogs());
      throw err;
    });
    await logSuccessTx(connection, sig, "placeBid");
    logger.color("green").log("placeBid tx sig", sig);

    // **Step 2: Remove listener after capturing the event**
    await program.removeEventListener(listener);

    // Handle final bid with a promise-based semaphore
    if (isFinalBid) {
      if (isLocal) {
        console.log("Final bid detected on local network: NOP, no raydium here...");
      }
      else {
        console.log("Final bid detected, waiting for auction migration...");
        const auctionFilledPromise = new Promise((resolve) => { // Create a promise and store its resolve function in the Map
          auctionFilledPromises.set(auctionId, resolve);
        });
        await auctionFilledPromise; // Wait for the event listener to resolve the promise
        console.log("Auction migration completed for auction ID:", auctionId);
      }
    }

    // Fetch post-bid data
    const bidderBalanceAfter = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceAfter = await connection.getBalance(auctionSol);
    const feeAccountBalanceAfter = await connection.getBalance(TEST_FEE_ACCOUNT.publicKey); // Final fee account balance
    const auctionPost = await program.account.auction.fetch(auctionData);
    const txDetails = await getTransactionDetailsWithRetry(connection, sig);
    const networkFee = txDetails.meta.fee; // Network transaction fee
    logObject("auctionPost", auctionPost);

    // Calculate bid amount and use actual fee from event
    const lastBid = auctionPost.bids[auctionPost.bids.length - 1];
    const bidAmountBN = lastBid.bidQty.mul(lastBid.bidSol); // Total SOL paid by bidder (excluding network fee)
    const expectedAuctionSolIncreaseBN = bidAmountBN.sub(actualBidFeeBN); // Auction receives bid amount minus fee

    // Convert to BN for precision
    const bidderBalanceBeforeBN = new BN(bidderBalanceBefore);
    const bidderBalanceAfterBN = new BN(bidderBalanceAfter);
    const auctionSolBalanceBeforeBN = new BN(auctionSolBalanceBefore);
    const auctionSolBalanceAfterBN = new BN(auctionSolBalanceAfter);
    const feeAccountBalanceBeforeBN = new BN(feeAccountBalanceBefore);
    const feeAccountBalanceAfterBN = new BN(feeAccountBalanceAfter);
    const networkFeeBN = new BN(networkFee); // Network fee in lamports

    // Calculate fee increase
    const feeIncreaseBN = feeAccountBalanceAfterBN.sub(feeAccountBalanceBeforeBN);
    console.log(`Fee account increase: ${(feeIncreaseBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Calculate minimum expected fee (1% of bidAmountBN)
    const minExpectedFeeBN = bidAmountBN.mul(new BN(1)).div(new BN(100)); // 1% of bid amount
    console.log(`Minimum expected fee (1% of bid): ${(minExpectedFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // **Validate that feeAccount increases by at least 1% of the SOL paid (excluding network fee)**
    assert.ok(feeIncreaseBN.gte(minExpectedFeeBN), `Fee account should increase by at least 1% of the bid amount. Actual increase: ${feeIncreaseBN.toString()}, Minimum expected: ${minExpectedFeeBN.toString()}`);

    // Validate based on bid type
    if (isFinalBid) {
      if (isLocal) {
        console.log("Final bid detected on local network: NOP, no raydium here...");
      }
      else { // Check Raydium liquidity move worked ok
        assert.equal(auctionSolBalanceAfter, 0, "All SOL should be withdrawn"); // Check all SOL withdrawn

        const lockPercent = auctionPost.lockPercent.toNumber(); // Calculate locked and expected remaining tokens
        const lockedTokensPercent = lockPercent / 10;
        const totalTokens = auctionPost.tokenSupply.toNumber();
        const lockedTokens = Math.floor((totalTokens * lockedTokensPercent) / 100);
        const expectedRemainingTokens = totalTokens - lockedTokens;

        const auctionTokenAccount = await getAssociatedTokenAddress(auctionPost.tokenMint, auctionSol, true); // Get auction token balance
        const auctionTokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
        const remainingTokens = parseInt(auctionTokenBalance.value.amount);

        console.log('lockPercent', lockPercent);
        console.log('lockedTokensPercent', lockedTokensPercent);
        console.log('totalTokens', totalTokens);
        console.log('lockedTokens', lockedTokens);
        console.log('expectedRemainingTokens', expectedRemainingTokens);
        console.log('remainingTokens', remainingTokens);

        assert.equal(remainingTokens, expectedRemainingTokens, "Remaining tokens should be total tokens minus locked tokens");
      }
    } else {
      // Standard bid checks
      assert.equal(auctionPost.bids.length - 1, auctionPre.bids.length, "Bid length should increase by 1");
      assert.equal(
        auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).eq(expectedAuctionSolIncreaseBN),
        true,
        "Auction SOL increase should match bid amount minus actual fee"
      );
      assert.equal(
        bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).eq(bidAmountBN.add(networkFeeBN)),
        true,
        "Bidder SOL decrease should match bid amount plus network fee"
      );
    }

    // Log results
    console.log("\nBid Validation Results:");
    console.log(`Bid amount: ${(bidAmountBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Auction SOL increase: ${(auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Bidder SOL decrease: ${(bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Network tx fee: ${(networkFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Actual auction fee: ${(actualBidFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  }

  async function test_cancel_bid() {
    console.log("Testing cancel_bid function...");

    // Derive PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1; // Latest auction ID
    console.log("Auction ID:", auctionId);
    const [auctionData] = PublicKey.findProgramAddressSync(
      [Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [auctionSol] = PublicKey.findProgramAddressSync(
      [Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Fetch auction data to confirm the bid exists
    const auctionDataBefore = await program.account.auction.fetch(auctionData);
    logObject("auctionDataBefore", auctionDataBefore);

    console.log("user2Kp.publicKey", user2Kp.publicKey.toBase58());
    const bid = auctionDataBefore.bids.find(b => b.bidder.equals(user2Kp.publicKey));
    console.log("bid", bid);
    assert.strictEqual(bid != undefined, true, "Bid should exist before cancellation");

    // Get bid details
    const bidQty = bid.bidQty.toNumber(); // Bid quantity in tokens
    const bidSol = bid.bidSol.toNumber(); // Price per token in lamports
    const bidAmount = bidQty * bidSol; // Total bid amount in lamports
    const auctionFee = bid.bidFee.toNumber(); // Fee paid during place_bid
    console.log("bidAmount:", bidAmount);
    console.log("auctionFee:", auctionFee);
    console.log("refundAmount:", bidAmount - auctionFee);

    // Capture the bidder's balance before cancellation
    const balanceBefore = await connection.getBalance(user2Kp.publicKey);

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
      console.error("logs:", await err.getLogs());
      throw err;
    }
    logger.color("green").log("cancelBid transaction signature", cancelSig);

    // Get transaction details to extract network fee
    const txDetails = await getTransactionDetailsWithRetry(connection, cancelSig);
    const networkFee = txDetails.meta.fee; // Network transaction fee for cancel_bid
    console.log(`Cancellation network fee: ${networkFee} lamports`);

    // Fetch auction data after cancellation
    const auctionDataAfter = await program.account.auction.fetch(auctionData);
    logObject("auctionDataAfter", auctionDataAfter);

    // Capture the bidder's balance after cancellation
    const balanceAfter = await connection.getBalance(user2Kp.publicKey);

    // Calculate the refund amount: bidAmount - auctionFee
    const refundAmount = bidAmount - auctionFee;

    // Calculate the expected balance: balanceBefore + refundAmount - networkFee
    const expectedBalance = balanceBefore + refundAmount - networkFee;
    console.log(`Expected balance: ${expectedBalance} lamports`);
    console.log(`Actual balance: ${balanceAfter} lamports`);

    // Assert exact equality
    assert.strictEqual(
      balanceAfter,
      expectedBalance,
      `Balance after cancellation should be exactly balanceBefore + (bidAmount - auctionFee) - networkFee: expected ${expectedBalance}, got ${balanceAfter}`
    );

    // Confirm the bid is removed
    assert.equal(auctionDataAfter.bids.length, 0, "Bid list should be empty after cancellation");
  }

  /*it("creates a market", async () => {
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
  });*/

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
  //await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
  const status = await connection.getSignatureStatus(sig);
  console.log("TX status:", status);

  // Fetch transaction details
  //const txDetails = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const txDetails = await getTransactionDetailsWithRetry(connection, sig);

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

async function getTransactionDetailsWithRetry(connection, signature, maxAttempts = 5, retryDelay = 1000) {
  let txDetails = null;
  let attempts = 0;

  while (txDetails === null && attempts < maxAttempts) {
    txDetails = await connection.getTransaction(signature, { commitment: 'confirmed' });
    if (txDetails === null) {
      console.log(`Transaction details not yet available for signature ${signature}, retrying in ${retryDelay / 1000} second(s)...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay)); // Wait for the specified delay
    }
    attempts++;
  }

  if (txDetails === null) {
    throw new Error(`Failed to fetch transaction details for signature ${signature} after ${maxAttempts} attempts`);
  }

  return txDetails;
}

export const getAndLockMaxiPrivKey = async () => {
  const pool = new sql.ConnectionPool(DB_CONFIG);
  await pool.connect();  // Select the oldest available key (unlocked and unused)
  const selectQuery = `
    SELECT TOP 1 PublicKey, SecretKey
    FROM [dbo].[KeyPair]
    WHERE locked_utc IS NULL
    AND used_utc IS NULL
    ORDER BY created_utc ASC
  `;
  const selectResult = await pool.request().query(selectQuery);
  if (selectResult.recordset.length === 0) throw new Error("No available maxi public keys found");

  const publicKey = selectResult.recordset[0].PublicKey;
  const secretKey = selectResult.recordset[0].SecretKey;
  const lockQuery = `
    UPDATE [dbo].[KeyPair]
    SET locked_utc = GETUTCDATE()
    WHERE PublicKey = @publicKey
  `;
  await pool
    .request()
    .input("publicKey", sql.VarChar(255), publicKey)
    .query(lockQuery);

  await pool.close();
  console.log(`Successfully locked key: ${publicKey}`);
  return secretKey;
};
const markMaxiKeyUsed = async (publicKey: string) => {
  const pool = new sql.ConnectionPool(DB_CONFIG);
  await pool.connect();
  const markUsedQuery = `
      UPDATE [dbo].[KeyPair] 
      SET used_utc = GETUTCDATE()
      WHERE PublicKey = @publicKey
    `;
  await pool
    .request()
    .input("publicKey", sql.VarChar(255), publicKey)
    .query(markUsedQuery);
  console.log(`Successfully marked key as used: ${publicKey}`);
  await pool.close();
};

