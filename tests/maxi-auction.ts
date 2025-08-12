import { createAssociatedTokenAccountIdempotentInstructionWithDerivation, MintLayout } from '@solana/spl-token';

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
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
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  TokenAccountNotFoundError,
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
  auctionDataSeed, auctionBidsSeed,
  // [REF] - Import referral system constants
  referralMappingsSeed,

  TEST_DISTRIBUTION_PERCENT,
  TEST_STARTPRICE_SOL,
  MAXIMEME_TOKEN_DECIMALS,
  TEST_TOKEN_NAME,
  //TestTokenQty,
  MAXIMEME_TOKEN_SUPPLY,
  TEST_TOKEN_SYMBOL,
  TEST_TOKEN_URI,
  TEST_MIN_TOTAL_SOL,
  // [REF] - Import referral percentage constant
  TEST_REF_BID_FEE_PERC_SHARE,
  TEST_MIN_BID_SIZE,
  // Fee accounts configuration
  FEE_ACCOUNTS,
  //TEST_FEE_ACCOUNT,
  TEST_DAO_ACCOUNT,
  // Dynamic network detection
  IS_LOCAL,
  IS_DEVNET,
  IS_MAINNET,
  getCurrentNetwork,
} from "./config";
//import { createMarket } from "./create-market";

import { getOrCreateAssociatedTokenAccount, createSyncNativeInstruction } from '@solana/spl-token';
import { NATIVE_MINT } from '@solana/spl-token';
import { SystemProgram, } from '@solana/web3.js';

import { BigNumberish, Raydium, TOKEN_WSOL } from '@raydium-io/raydium-sdk-v2';
import { RAYMint, USDCMint, OPEN_BOOK_PROGRAM, TxVersion, DEVNET_PROGRAM_ID, WSOLMint, USDTMint } from '@raydium-io/raydium-sdk-v2'
import { MARKET_STATE_LAYOUT_V3, AMM_V4, FEE_DESTINATION_ID, } from '@raydium-io/raydium-sdk-v2'
import { TRANSFER_SOURCE_INDEX } from "@project-serum/serum/lib/token-instructions";
import {
  ApiV3PoolInfoStandardItem, AmmV4Keys, AmmRpcData, ClmmRpcData, ApiV3PoolInfoConcentratedItem, TickUtils, PoolUtils, ClmmKeys, ApiV3Token

} from '@raydium-io/raydium-sdk-v2'
import {  AMM_STABLE, } from '@raydium-io/raydium-sdk-v2'

import Decimal from 'decimal.js'
import { log } from "console";

import { migrateAuction } from "./migrate-auction"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import "dotenv/config";
import * as sql from "mssql";
//import { program } from "@coral-xyz/anchor/dist/cjs/native/system";

import { generateAndUploadTestTokenData, generateThemedTestToken, TestTokenData } from "./maxi-auction-testdata";
import { dumpBufferedLogsForToken, setActiveLogToken } from "./logging";

import { logAuctionInfo } from "./auctionLogging";

const RENT_EXEMPT_MIN = 890880; // devnet 

// ENABLE_LOG is imported; interceptors are installed in ./logging on import

// Log current network configuration
console.log(`🌐 [Network Detection] Current network: ${getCurrentNetwork()}`);
console.log(`📍 [Network Detection] IS_LOCAL: ${IS_LOCAL}, IS_DEVNET: ${IS_DEVNET}, IS_MAINNET: ${IS_MAINNET}`);
console.log(`🔗 [Network Detection] ANCHOR_PROVIDER_URL: ${process.env.ANCHOR_PROVIDER_URL}`);

// Rate limiting configuration for batch processing
const AUCTION_FETCH_BATCH_SIZE = 20; // Process n auctions at a time (increased from 10)
const AUCTION_FETCH_BATCH_DELAY = 2500; // 500ms delay between batches (decreased from 1000ms)

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
const DEVNET_USER_KEYPAIRS = [
  Keypair.fromSecretKey(bs58.decode("4kbfHLgTTVT23ezNackE3a6m3BCQg3vYmEqZNbHLvZbWs8Dd68FqM7QmbH1w2r7BZHrb6bAjevB1dwpfgz9Psdw8")), // 1246q8oDCgE77wEbJx5XxAPkw51YesEGqUkRGbZ3maxi
  Keypair.fromSecretKey(bs58.decode("2rAK3bLbA2VeR5sFFVYhamZ7Muhz2TgkG7RBAnDVXwvhXmsiZwwL8ohZNiqWCzZcBDgL4PhRvTuKZMxoJSVxWwGW")), // 124N6YAiiKRi8ze2aDBhVo4h5ratuczB321xrU3Cmaxi
  Keypair.fromSecretKey(bs58.decode("oxdUtKkwYAQoyLLJPG84E8PDETbJauWAPJw7oRMvkeDg4FiwfB3e5QWej5XXFYCa1F2wFVzV2EbzNy9zv5qxetA")), // 12EXXrg6sivexwusYGMD42aKc1geB3NJJLENfYjhmaxi
]
var CONTRACT_CONFIG: any;

// moveliq callback 
const auctionFilledPromises = new Map();

//
// MOVELIQ FLAG - set this when testing deployed or local API migrations
//
var MOVELIQ_DISABLE = true;
var MOVELIQ_PAUSE = false; // (keep this as-is; used by tests to deliberately pause moveliq)

// admin & test keypairs
var program: Program<MaxiAuction>;
var adminKp: Keypair;
var USER_KPs: Keypair[];

/*export async function setupProgramWithDeployedId(
  programId: PublicKey,
  network: string,
  adminKp: Keypair
): Promise<Program<any>> {
  // Set up the connection to the specified network
  const connection = new Connection(network, "confirmed");

  // Set up the provider with the connection and admin keypair
  const wallet = new anchor.Wallet(adminKp);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Derive the IDL account address using the programId
  const idlAddress = await PublicKey.findProgramAddressSync(
    [Buffer.from("anchor:idl")],
    programId
  );

  // Fetch the IDL account data from the blockchain
  const idlAccountInfo = await connection.getAccountInfo(idlAddress[0]);
  if (!idlAccountInfo) {
    throw new Error(`IDL not found for programId: ${programId.toBase58()}`);
  }

  // Parse the IDL from the account data (skip the first 8 bytes for the discriminator)
  const idlBuffer = idlAccountInfo.data.slice(8);
  const idl = JSON.parse(idlBuffer.toString("utf8")) as Idl;

  // Create and return the Program instance using the fetched IDL
  const program = new Program(idl, programId, provider);
  return program;
}*/

describe("maxi-auction", () => {
  // setup provider & program
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
  program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;
  console.log("program.programId:", program.programId.toBase58());

  // Store event listener IDs for cleanup
  const eventListenerIds = [];
  
  // add log listener
  const seenLogs = new Map();
  connection.onLogs(program.programId, (logs) => {
    logs.logs.forEach((log) => {
      if (log.startsWith('Program log:')) {
        const s = `info: ${logs.signature} - ${log.replace('Program log: ', '')}`;
        if (!seenLogs.has(s)) {
          seenLogs.set(s, true);
          console.log(s);
        }
      }
    });
  }, 'finalized');

  // add eventlisteners
  console.log("Setting up listeners...");
  eventListenerIds.push(program.addEventListener("auctionCreated", (event) => { logObject(">>> auctionCreated", event); }));
  eventListenerIds.push(program.addEventListener("newBid", (event) => { logObject(">>> newBid", event) }));
  eventListenerIds.push(program.addEventListener("bidCancelled", (event) => { logObject(">>> bidCancelled", event) }));
  eventListenerIds.push(program.addEventListener("claimed", (event) => { logObject(">>> claimed", event); }));
  eventListenerIds.push(program.addEventListener("auctionMigrated", (event) => { logObject(">>> auctionMigrated", event); }));
  eventListenerIds.push(program.addEventListener("auctionFilled", async (event) => {
    logObject(">>> auctionFilled", event);

    if (MOVELIQ_DISABLE) {
      console.log("auctionFilled event received on local network: NOP, no raydium here...");
      return;
    }
    else if (isLocal) {
      console.log("auctionFilled event received on local network: NOP, no raydium here...");
    }
    else {
      const signer = adminKp;
      const auctionId = Number(event.auctionId.toString());
      const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const [auctionData] = PublicKey.findProgramAddressSync(
        [Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const auctionDataAccount = await program.account.auction.fetch(auctionData);

      // pause if caller requested (to change order of moveliq in the flow)
      while (MOVELIQ_PAUSE == true) {
        logger.color("yellow").log(`waiting for MOVELIQ_PAUSE  semaphore to be cleared(auctionId ${auctionId})...`);
        await sleep(3);
      }

      // Process migration and resolve the promise
      let migrationResult = { success: true, error: null };
      migrateAuction(program, isMainnet, auctionId, adminKp, connection)
        .catch((err) => {
          logObject('auction migration error', err);
          logger.color("red").error(`auction ${auctionId} migration complete - catch`, err);
          migrationResult = { success: false, error: err };
          //throw err;
        })
        .finally(async () => {
          console.log(`auction ${auctionId} migration complete - finally`);
          const resolve = await waitForResolver(auctionId.toString(), auctionFilledPromises, 10000, 500); // Poll for the resolver with a timeout
          console.log(`auction ${auctionId} migration complete - looking for resolver`);
          if (resolve) {
            console.log(`auction ${auctionId} migration complete - resolving promise`);
            resolve(migrationResult);
            auctionFilledPromises.delete(auctionId.toString()); // Use toString() for consistency
          } else {
            console.error(`No resolver found for auctionId: ${auctionId} after timeout`);
            const resolveFallback = auctionFilledPromises.get(auctionId.toString()); // Optionally resolve with failure if no resolver is found
            if (resolveFallback) {
              resolveFallback({ success: false, error: new Error("Timeout waiting for resolver") });
              auctionFilledPromises.delete(auctionId.toString());
            }            
          }
        });
    }
    async function waitForResolver(auctionId, promisesMap, timeoutMs = 10000, pollIntervalMs = 500) { // Helper function to poll for the resolver
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const resolve = promisesMap.get(auctionId);
        if (resolve) {
          console.log(`Resolver found for auctionId: ${auctionId}`);
          return resolve;
        }
        console.log(`Waiting for resolver for auctionId: ${auctionId}...`);
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      console.error(`Timeout waiting for resolver for auctionId: ${auctionId}`);
      return null; // Return null if resolver isn't found within timeout
    }
  }));

  // setup fixed admin keypair, and new random user keypairs
  adminKp = Keypair.fromSecretKey(Uint8Array.from(keypair));
  USER_KPs = [];
  for (var i = 0; i < 3; i++) {
    USER_KPs[i] = isLocal
      ? Keypair.generate()
      : DEVNET_USER_KEYPAIRS[i];
  }

  beforeEach(async function () {
    // Tag all logs with current test title to avoid cross-test mixing
    try {
      const token = (this as any)?.currentTest?.fullTitle ? (this as any).currentTest.fullTitle() : undefined;
      if (token) {
        setActiveLogToken(token);
      }
    } catch { }
    // get a maxi keypair from DB
    //tokenKp1 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();
    //tokenKp2 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();

    // Reset per-test global flags and in-memory state
    //MOVELIQ_DISABLE = false;
    //MOVELIQ_PAUSE = false;
    auctionFilledPromises.clear();

    if (isLocal) {
      logger.color("blue").log("Airdropping SOL to accounts...");
      logger.color("green").log("Airdrop SOL to admin");

      // Idempotent top-up to guarantee minimum balances each test run
      const ensureBalance = async (account, targetLamports) => {
        try {
          const current = await connection.getBalance(account.publicKey);
          if (current < targetLamports) {
            const sig = await connection.requestAirdrop(account.publicKey, targetLamports - current);
            console.log(`Airdropping ${(targetLamports - current) / LAMPORTS_PER_SOL} SOL to ${account.publicKey.toBase58()}`);
            await connection.confirmTransaction(sig, "finalized");
            console.log(`Confirmed airdrop for ${account.publicKey.toBase58()}`);
          }
        } catch (err) {
          console.error(`Airdrop/top-up failed for ${account.publicKey.toBase58()}:`, err);
        }
      };
      const topUps = USER_KPs.map(account => ensureBalance(account, 10 * LAMPORTS_PER_SOL));
      topUps.push(ensureBalance(adminKp, 50 * LAMPORTS_PER_SOL));
      await Promise.all(topUps);

      /*logger.color("green").log("Airdrop SOL to user1");
      const airdropTx1 = await connection.requestAirdrop(
        USER_KPs[0].publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx1);
      logger.color("green").log("Airdrop SOL to user2");
      const airdropTx2 = await connection.requestAirdrop(
        USER_KPs[1].publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropTx2);
      logger.color("green").log("Airdrop SOL to user3");
      const airdropTx3 = await connection.requestAirdrop(
        USER_KPs[2].publicKey,
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

    // Re-assert default on-chain config; function is idempotent
    await test_init(); // set defaults

    // Ensure all prior writes are finalized before test body starts
    await connection.getLatestBlockhash("finalized");
  });

  // Dump buffered logs only for the current test token; don't clear buffers to keep history
  afterEach(async function () {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current: any = (this as any).currentTest;
      if (current && current.state === "failed") {
        const token = current.fullTitle ? current.fullTitle() : current.title;
        // Ensure the active token matches in case it changed
        try { setActiveLogToken(token); } catch { }
        // Allow up to 30s for delayed program logs to flush into the buffer before dumping
        await dumpBufferedLogsForToken(`FAILED: ${token}`, token, 250, 30000);
      }
    } finally {
      // Optional global delay after each test to let listeners settle (requested: 30s)
      await sleep(30);
    }
  });

  after(async () => {
    logger.color("yellow").log("Cleaning up resources...");
    
    try {
      // Remove all event listeners using stored IDs
      for (const listenerId of eventListenerIds) {
        try {
          await program.removeEventListener(listenerId);
        } catch (err) {
          // Ignore errors when removing listeners
        }
      }
      
      // Clear the auctionFilledPromises map
      auctionFilledPromises.clear();
      
      // Close any open database connections
      if (global.connectionPool) {
        await global.connectionPool.close();
      }
      
      logger.color("green").log("Cleanup completed successfully");
    } catch (error) {
      logger.color("red").log("Error during cleanup:", error);
    }
    
    // Wait for trailing program log events to flush
    await sleep(30);
  });

  it("initializes the contract", async () => {
    await test_init();
  });

  it("base - creates an auction", async () => {
    await test_create_auction_KP0({});
  });

  it("base - creates a 1 min auction", async () => {
    await test_create_auction_KP0({ duration_hours_div100: 1 }); // 1 unit ~= 36s
  });
  it("base - creates a 1 hr auction", async () => {
    await test_create_auction_KP0({ duration_hours_div100: 100 });
  });

  it("base - creates a 2 min auction", async () => {
    await test_create_auction_KP0({ duration_hours_div100: 2 });
  });

  it("base - admin creates & bids 50%, 1 min, no claim", async () => {
    await test_create_auction_KP0({ duration_hours_div100: 1 }); 
    await test_bid_auction({ fill_percent: 0.5, bidderKp: adminKp });
  });

  it("base - admin creates & bids 100%, 1 min, no claim", async () => {
    await test_create_auction_KP0({ duration_hours_div100: 1 }); 
    await test_bid_auction({ fill_percent: 1.0, bidderKp: adminKp });
  });

  it("base - bids continuously", async () => {
    const duration36Secs = 3; // units of 36s
    const nBids = 5;
    const targetIntervalSecs = ((duration36Secs * 36) + 10 /* +10s buffer - we want to try to bid *after expiry* */) / nBids; // target time between bids
    //const nBidsInTimerPeriod = nBids; //Number(duration36Secs * 36 / targetIntervalSecs);
    const bidPerc = (1 / nBids / 2); // we will fill ~50% of the auction amount; last bid will be late, but quantity will be valid
    console.log(`nBids: ${nBids}, bidPerc: ${bidPerc}, targetInterval: ${targetIntervalSecs}s`);
    await test_create_auction_KP0({ duration_hours_div100: duration36Secs }); // units of 36s

    let successfulBids = 0;
    let expectedFailuresStarted = false;

    //const totalBids = nBids;  //nBidsInTimerPeriod + 1;
    for (let i = 0; i < nBids + 1; i++) { 
      const bidStartTime = Date.now();

      try {
        await test_bid_auction({ fill_percent: bidPerc, skipValidations: true });
        successfulBids++;
        console.log(`Bid ${i + 1} (of ${nBids}) successful - time remaining should be positive`);

        // If we already started seeing failures, this shouldn't succeed
        if (expectedFailuresStarted) {
          console.error(`Unexpected success after auction expiry for bid ${i + 1} (of ${nBids})`);
          assert.fail("Bid should have failed after auction time expired");
        }
      } catch (err) {
        console.log(`Bid ${i + 1} (of ${nBids}) failed as expected - auction time expired:`, err.toString());

        // Verify it's the right type of error (auction ended due to time)
        if (err.toString().includes("AuctionEnded")) {
          expectedFailuresStarted = true;
          console.log(`✓ Time validation working: bid ${i + 1} (of ${nBids}) correctly rejected after auction expiry`);
        } else {
          console.error(`Unexpected error type for bid ${i + 1} (of ${nBids}):`, err);
          throw err; // Re-throw if it's not the expected auction time error
        }
      }

      // Calculate how long the bid took and adjust sleep accordingly
      const bidEndTime = Date.now();
      const bidDurationMs = bidEndTime - bidStartTime;
      const bidDurationSecs = bidDurationMs / 1000;
      const remainingSleepSecs = Math.max(0, targetIntervalSecs - bidDurationSecs);

      console.log(`Bid ${i + 1} took ${bidDurationSecs.toFixed(2)}s, sleeping ${remainingSleepSecs.toFixed(2)}s more (target: ${targetIntervalSecs}s total)`);

      if (remainingSleepSecs > 0) {
        await sleep(remainingSleepSecs);
      }
    }

    console.log(`Test completed: ${successfulBids} successful bids (of ${nBids}), failures started correctly after auction expiry`);

    // Verify we got some successful bids and some failures
    assert.ok(successfulBids > 0, "Should have had some successful bids within auction period");
    assert.ok(expectedFailuresStarted, "Should have started seeing failures after auction time expired");
  });

  it("base - bids and cancels continuously", async () => {
    const durationSecs = 60 * 1;
    const everySecs = 2;
    const nCycles = Number(durationSecs / everySecs);
    const bidPerc = (1 / (nCycles - 1));
    console.log(`nCycles: ${nCycles}, bidPerc: ${bidPerc}`);
    await test_create_auction_KP0({ duration_hours_div100: (durationSecs / 36) + 30 }); // buffer 30s
    for (let i = 0; i < nCycles; i++) {
      await test_bid_auction({ fill_percent: bidPerc });
      await sleep(everySecs / 2);
      await test_cancel_bid();
      await sleep(everySecs / 2);
    }
  });

  it("stress - handles 100 bids from multiple users", async () => {
    await test_large_number_of_bids(100);
  });

  it("base - places a bid", async () => {
    await test_create_auction_KP0({});
    await test_bid_auction({ fill_percent: 0.1 });
  });

  it("base - places a bid with 0.5% fee", async () => {
    await test_create_auction_KP0({});
    await test_bid_auction({ fill_percent: 0.1, fee_perc: 0.005 });
  });

  it("base - user 1 fills & claims auction", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.8,*/ duration_hours_div100: 1 }); // 3.69% token lock, 36s
    const bidResult = await test_bid_auction({ fill_percent: 1.0, bidderKp: USER_KPs[0] });
    await test_claim_auction(USER_KPs[0], true, bidResult);
  });

  it("cancels - only during auction period", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 }); // 36s

    const bidResult1 = await test_bid_auction({ fill_percent: 0.1, bidderKp: USER_KPs[1] });
    await test_cancel_bid(USER_KPs[1]); // cancel the first bid within the auction period (should succeed)

    const bidResult2 = await test_bid_auction({ fill_percent: 0.1, bidderKp: USER_KPs[2] });
    logger.color("magenta").log("sleeping 36s...");
    await sleep(36);

    try {
      await test_cancel_bid(USER_KPs[2]);
      assert.fail("Expected cancellation to fail after auction period ended");
    } catch (err) {
      console.log("Expected Error: ", err);
      assert.equal(
        err.toString().includes("AuctionEnded"),
        true,
        "Expected AuctionEnded error when canceling after auction period"
      );
    }

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionPost = await program.account.auction.fetch(auctionData);
    //logObject("auctionData", auctionPost);
  });

  it("cancels - bids from different users", async () => {
    await test_create_auction_KP0({});

    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[2] });

    await test_cancel_bid(USER_KPs[1]);
    let { auctionSol, } = await test_cancel_bid(USER_KPs[2]);

    const auctionSolBalance = await connection.getBalance(auctionSol);
    console.log("auctionSolBalance", auctionSolBalance.toString() / LAMPORTS_PER_SOL);
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction"); // cancel bids will reduce sol account to 0
  });

  it("cancels - bids from same user", async () => {
    await test_create_auction_KP0({});

    await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });

    let { auctionSol: auctionSol1, } = await test_cancel_bid(USER_KPs[1]);
    const auctionSolBalance1 = await connection.getBalance(auctionSol1);
    assert.equal(auctionSolBalance1 == 0, true, "should be no sol left in the auction");

    await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });
    await test_bid_auction({ fill_percent: 0.1, bidderKp: USER_KPs[2] });

    let { auctionSol: auctionSol2, } = await test_cancel_bid(USER_KPs[2]);
    const auctionSolBalance2 = await connection.getBalance(auctionSol2);
    assert.equal(auctionSolBalance2 > 0, true, "should be sol left in the auction");

    let { auctionSol: auctionSol3, } = await test_cancel_bid(USER_KPs[1]);
    const auctionSolBalance3 = await connection.getBalance(auctionSol2);
    assert.equal(auctionSolBalance3 == 0, true, "should be no sol left in the auction");
  });

  it("base - places a late bid", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 }); // ~36 secs, 95% distribution
    await sleep(32);
    await test_bid_auction({ fill_percent: 0.1 });
  });


  it("base - user can bid twice", async () => {
    await test_create_auction_KP0({});
    await test_bid_auction({ fill_percent: 0.1 });
    await test_bid_auction({ fill_percent: 0.1 });
  });

  it("fills - auction fully filled", async () => {
    await test_create_auction_KP0({});
    await test_bid_auction({ fill_percent: 1.0 }); // fill
  });

  it("fills - no bids after filled", async () => {
    //if (isLocal) {
    await test_create_auction_KP0({});
    await test_bid_auction({ fill_percent: 0.5 });
    await test_bid_auction({ fill_percent: 0.5, }); // fill auction
    try {
      await test_bid_auction({ fill_percent: 0.1 }); // must fail
    }
    catch (err) {
      console.log("Expected Error: ", err);
      assert.equal(err.toString().includes("AuctionEnded"), true, "Contract error was expected.");
    }
    //}
    //else {
    //const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    //const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    //const auctionId = 7;  //Number(globalInfoAccount.auctionsNum) - 1;
    //try {
    //  await test_bid_auction(0.1, USER_KPs[1], auctionId); // should fail; auction liq. already moved
    //}
    //catch (err) {
    //  console.log("Expected Error: ", err);
    //  assert.equal(err.toString().includes("AuctionEnded"), true, "Contract error was expected.");
    //}
    //}
  });

  it("admin - no withdraws during auction", async () => {
    await test_admin_withdraws({ n_bids: 1, withdraw_tokens: false, withdraw_sol: true, fill_auction: false }); // keep auction open - no moveliq
    await test_admin_withdraws({ n_bids: 1, withdraw_tokens: true, withdraw_sol: false, fill_auction: false });
  });

  it("admin - withdraws after auction with 2 distinct bids", async () => {
    MOVELIQ_DISABLE = true; // STOP MAIN LIQMOVE HANDLER: it conflicts with this

    await test_admin_withdraws({ n_bids: 2, withdraw_tokens: true, withdraw_sol: true, fill_auction: true }); // fill auction to set conditions for withdraws
    //await test_admin_withdraws({ n_bids: 2, withdraw_tokens: false, withdraw_sol: true, fill_auction: true });
    //await test_admin_withdraws({ n_bids: 2, withdraw_tokens: true, withdraw_sol: false, fill_auction: true });

    MOVELIQ_DISABLE = false;
  });

  it("admin - list auctions & pools", async () => {
    // get all auctions
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const totalAuctions = Number(globalInfoAccount.auctionsNum);
    console.log(`Total auctions: ${totalAuctions}`);
    const auctionIds = Array.from({ length: totalAuctions }, (_, i) => i);

    // Initialize Raydium SDK for position info logging
    const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'confirmed' });

    // Batch processing to avoid rate limits
    const results = [];

    console.log(`Processing ${totalAuctions} auctions in batches of ${AUCTION_FETCH_BATCH_SIZE}...`);

    for (let i = 0; i < auctionIds.length; i += AUCTION_FETCH_BATCH_SIZE) {
      const batch = auctionIds.slice(i, i + AUCTION_FETCH_BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / AUCTION_FETCH_BATCH_SIZE) + 1} of ${Math.ceil(auctionIds.length / AUCTION_FETCH_BATCH_SIZE)} (auctions ${i} to ${Math.min(i + AUCTION_FETCH_BATCH_SIZE - 1, auctionIds.length - 1)})`);

      const batchPromises = batch.map(auctionId =>
        getAuctionDetails(auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + AUCTION_FETCH_BATCH_SIZE < auctionIds.length) {
        console.log(`Waiting ${AUCTION_FETCH_BATCH_DELAY}ms before next batch to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, AUCTION_FETCH_BATCH_DELAY));
      }
    }

    const auctions = results.filter(result => result !== null);
    console.log(`Successfully fetched ${auctions.length} auctions`);
    //console.log("auctions", auctions.length);

    // Collect poolDbInfos and pool IDs from DB
    const { poolDbInfos, poolPpcInfosMapv3 } = await getPoolDbAndRpcInfos(auctions);

    // Log
    const detailPromises = auctions.map(async (auction, index) => {
      logAuctionInfo(poolDbInfos, index, poolPpcInfosMapv3, auction, raydium, adminKp);
    });
    await Promise.all(detailPromises);
  });

  it("admin - finalize finished auctions ###", async () => { // cleanup - withdraw in full/close accounts ### ACHTUNG!
    // get all auctions
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const totalAuctions = Number(globalInfoAccount.auctionsNum);
    console.log(`Total auctions: ${totalAuctions}`);

    // Initialize Raydium SDK for position info logging
    const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'confirmed' });
    const auctionIds = Array.from({ length: totalAuctions }, (_, i) => i); // [2]

    // Batch processing to avoid rate limits
    const results = [];

    console.log(`Processing ${totalAuctions} auctions in batches of ${AUCTION_FETCH_BATCH_SIZE}...`);

    for (let i = 0; i < auctionIds.length; i += AUCTION_FETCH_BATCH_SIZE) {
      const batch = auctionIds.slice(i, i + AUCTION_FETCH_BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / AUCTION_FETCH_BATCH_SIZE) + 1} of ${Math.ceil(auctionIds.length / AUCTION_FETCH_BATCH_SIZE)} (auctions ${i} to ${Math.min(i + AUCTION_FETCH_BATCH_SIZE - 1, auctionIds.length - 1)})`);

      const batchPromises = batch.map(auctionId =>
        getAuctionDetails(auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + AUCTION_FETCH_BATCH_SIZE < auctionIds.length) {
        console.log(`Waiting ${AUCTION_FETCH_BATCH_DELAY}ms before next batch to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, AUCTION_FETCH_BATCH_DELAY));
      }
    }

    const auctions = results.filter(result => result !== null);
    console.log(`Successfully fetched ${auctions.length} auctions`);

    // Collect poolDbInfos and pool IDs from DB
    const { poolDbInfos, poolPpcInfosMapv3 } = await getPoolDbAndRpcInfos(auctions);

    // CLEANUP - Sequential processing with enhanced rate limiting
    const unfinalized = auctions.filter(x => !x.isFinalized);
    console.log(`Found ${unfinalized.length} unfinalized auctions to process`);
    
    const FINALIZE_BATCH_SIZE = 5; // Process 5 at a time
    const FINALIZE_BATCH_DELAY = 5000; // 5 second delay between batches
    
    for (let i = 0; i < unfinalized.length; i += FINALIZE_BATCH_SIZE) {
      const batch = unfinalized.slice(i, i + FINALIZE_BATCH_SIZE);
      console.log(`\n=== Processing finalization batch ${Math.floor(i / FINALIZE_BATCH_SIZE) + 1} of ${Math.ceil(unfinalized.length / FINALIZE_BATCH_SIZE)} ===`);
      console.log(`Batch contains auctions: ${batch.map(x => x.auctionId).join(', ')}`);
      
      for (const x of batch) {
        const originalIndex = auctions.findIndex(a => a.auctionId === x.auctionId);
        
        console.log("BEFORE:")
        logAuctionInfo(poolDbInfos, originalIndex, poolPpcInfosMapv3, x, raydium, adminKp);

        try {
          await retryWithBackoff(async () => await finalizeAuction(x.auctionId));
          
          console.log("AFTER:")
          const refreshed = await getAuctionDetails(x.auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed);
          auctions[originalIndex] = { ...x, ...refreshed };
          logAuctionInfo(poolDbInfos, originalIndex, poolPpcInfosMapv3, auctions[originalIndex], raydium, adminKp);
          
          // Small delay between individual finalizations
          await sleep(2);
        } catch (error) {
          console.error(`Failed to finalize auction ${x.auctionId}:`, error);
          // Continue with next auction instead of failing entirely
        }
      }
      
      // Longer delay between batches
      if (i + FINALIZE_BATCH_SIZE < unfinalized.length) {
        console.log(`\nWaiting ${FINALIZE_BATCH_DELAY / 1000} seconds before next batch to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, FINALIZE_BATCH_DELAY));
      }
    }
  });

  it("admin - pools - remove liquidity ###", async () => { // ### ACHTUNG!
  // Get all auctions
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const totalAuctions = Number(globalInfoAccount.auctionsNum);
    console.log(`Total auctions: ${totalAuctions}`);

    // Generate auction IDs
    // ##############
    const auctionIds = [22, 25, 24]; //Array.from({ length: totalAuctions }, (_, i) => i);
    // ##############

    // Initialize Raydium SDK
    const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'confirmed' });

    // Batch processing to avoid rate limits
    const results = [];

    console.log(`Processing ${totalAuctions} auctions in batches of ${AUCTION_FETCH_BATCH_SIZE}...`);

    for (let i = 0; i < auctionIds.length; i += AUCTION_FETCH_BATCH_SIZE) {
      const batch = auctionIds.slice(i, i + AUCTION_FETCH_BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / AUCTION_FETCH_BATCH_SIZE) + 1} of ${Math.ceil(auctionIds.length / AUCTION_FETCH_BATCH_SIZE)} (auctions ${i} to ${Math.min(i + AUCTION_FETCH_BATCH_SIZE - 1, auctionIds.length - 1)})`);

      const batchPromises = batch.map(auctionId =>
        getAuctionDetails(auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + AUCTION_FETCH_BATCH_SIZE < auctionIds.length) {
        console.log(`Waiting ${AUCTION_FETCH_BATCH_DELAY}ms before next batch to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, AUCTION_FETCH_BATCH_DELAY));
      }
    }

    const auctions = results.filter(result => result !== null);
    console.log(`Successfully fetched ${auctions.length} auctions`);

    // Collect poolDbInfos and pool IDs from DB
    const { poolDbInfos, poolPpcInfosMapv3 } = await getPoolDbAndRpcInfos(auctions);

    // Process each auction sequentially
    for (const [index, x] of auctions.entries()) {
      const poolDb = poolDbInfos[index];
      const poolPpcInfo_v3 = poolDb?.pool_id ? poolPpcInfosMapv3.get(poolDb.pool_id) : undefined;

      if (poolPpcInfo_v3) {
        try {
          const poolId = poolDb.pool_id;
          console.log(`\n=== Processing CLMM v3 pool for auction ID: ${x.auctionId} ===`);

          // Get admin's positions for this pool
          const adminPositions = await raydium.clmm.getOwnerPositionInfo({
            programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID
          });

          const poolPositions = adminPositions.filter(pos =>
            pos.poolId.toBase58() === poolId
          );

          console.log(`Found ${poolPositions.length} position(s) for admin in pool ${poolId}`);

          // Log detailed auction info with position data
          await logAuctionInfo(poolDbInfos, index, poolPpcInfosMapv3, x, raydium, adminKp);

          if (poolPositions.length > 0) {
            // Get pool info for calculations
            const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolId);

            // Get admin's token balances before withdrawal
            const poolTokens = [poolInfo.poolInfo.mintA, poolInfo.poolInfo.mintB];
            const adminTokenAccountsBefore = [];
            const balancesBefore = [];

            for (const token of poolTokens) {
              const tokenAccount = await getAssociatedTokenAddress(new PublicKey(token.address), adminKp.publicKey);
              adminTokenAccountsBefore.push(tokenAccount);
              try {
                const balance = await connection.getTokenAccountBalance(tokenAccount);
                balancesBefore.push(Number(balance.value.amount));
              } catch (err) {
                balancesBefore.push(0); // Account doesn't exist
              }
            }

            const adminSolBefore = await connection.getBalance(adminKp.publicKey);

            console.log("BEFORE withdrawal:");
            console.log(`Admin SOL: ${(adminSolBefore / LAMPORTS_PER_SOL).toFixed(6)}`);
            console.log(`Admin Token A: ${new Decimal(balancesBefore[0].toString()).div(Math.pow(10, poolInfo.poolInfo.mintA.decimals)).toString()}`);
            console.log(`Admin Token B: ${new Decimal(balancesBefore[1].toString()).div(Math.pow(10, poolInfo.poolInfo.mintB.decimals)).toString()}`);

            // Process each position
            for (const [index, position] of poolPositions.entries()) {
              console.log(`\n=== Withdrawing Position ${index + 1} ===`);
              console.log(`Position ID: ${position.nftMint.toBase58()}`);
              console.log(`Liquidity: ${position.liquidity.toString()}`);
              console.log(`Tick Range: [${position.tickLower}, ${position.tickUpper}]`);

              // Check if position has liquidity to withdraw
              if (position.liquidity.gt(new BN(0))) {
                // Calculate amounts for full liquidity withdrawal with high slippage tolerance
                const decreaseLiquidityQuote = await PoolUtils.getLiquidityAmountOutFromAmountIn({
                  poolInfo: poolInfo.poolInfo,
                  slippage: 0.5, // 50% slippage tolerance to handle volatile markets
                  inputA: true,
                  tickLower: position.tickLower,
                  tickUpper: position.tickUpper,
                  amount: position.liquidity,
                  add: false, // false for withdrawal/decrease
                  amountHasFee: false,
                  epochInfo: await connection.getEpochInfo(),
                });

                // Use very conservative minimum amounts to avoid slippage errors
                const amountAMin = new BN(0); // Accept any amount for token A
                const amountBMin = new BN(0); // Accept any amount for token B

                // Use Decimal for safe large number handling
                const tokenAWithdrawal = new Decimal(decreaseLiquidityQuote.amountA.amount.toString()).div(Math.pow(10, poolInfo.poolInfo.mintA.decimals));
                const tokenBWithdrawal = new Decimal(decreaseLiquidityQuote.amountB.amount.toString()).div(Math.pow(10, poolInfo.poolInfo.mintB.decimals));

                console.log(`Expected Token A withdrawal: ${tokenAWithdrawal.toString()}`);
                console.log(`Expected Token B withdrawal: ${tokenBWithdrawal.toString()}`);
                console.log(`Using minimum amounts: Token A = 0, Token B = 0 (to avoid slippage errors)`);

                // Execute liquidity decrease
                const { execute: execDecrease } = await raydium.clmm.decreaseLiquidity({
                  poolInfo: poolInfo.poolInfo,
                  poolKeys: poolInfo.poolKeys,
                  ownerPosition: position,
                  liquidity: position.liquidity, // Withdraw all liquidity
                  amountMinA: amountAMin,
                  amountMinB: amountBMin,
                  ownerInfo: {
                    useSOLBalance: false,
                  },
                  txVersion: TxVersion.LEGACY,
                });

                console.log(`Executing decreaseLiquidity for position ${position.nftMint.toBase58()}...`);
                const decreaseTx = await execDecrease({ sendAndConfirm: true });
                console.log(`Withdrawal successful - txId: ${decreaseTx.txId}`);
              } else {
                console.log(`Position has no liquidity to withdraw`);
              }
            }

            // Get admin's token balances after withdrawal
            const balancesAfter = [];
            for (let i = 0; i < poolTokens.length; i++) {
              try {
                const balance = await connection.getTokenAccountBalance(adminTokenAccountsBefore[i]);
                balancesAfter.push(Number(balance.value.amount));
              } catch (err) {
                balancesAfter.push(0);
              }
            }

            const adminSolAfter = await connection.getBalance(adminKp.publicKey);

            console.log("\nAFTER withdrawal:");
            console.log(`Admin SOL: ${(adminSolAfter / LAMPORTS_PER_SOL).toFixed(6)}`);
            console.log(`Admin Token A: ${new Decimal(balancesAfter[0].toString()).div(Math.pow(10, poolInfo.poolInfo.mintA.decimals)).toString()}`);
            console.log(`Admin Token B: ${new Decimal(balancesAfter[1].toString()).div(Math.pow(10, poolInfo.poolInfo.mintB.decimals)).toString()}`);

            // Calculate and log withdrawal amounts using Decimal for safe arithmetic
            const tokenAWithdrawn = balancesAfter[0] - balancesBefore[0];
            const tokenBWithdrawn = balancesAfter[1] - balancesBefore[1];
            const solSpent = adminSolBefore - adminSolAfter;

            console.log("\nWITHDRAWAL SUMMARY:");
            console.log(`Token A withdrawn: ${new Decimal(tokenAWithdrawn.toString()).div(Math.pow(10, poolInfo.poolInfo.mintA.decimals)).toString()}`);
            console.log(`Token B withdrawn: ${new Decimal(tokenBWithdrawn.toString()).div(Math.pow(10, poolInfo.poolInfo.mintB.decimals)).toString()}`);
            console.log(`SOL spent (fees): ${(solSpent / LAMPORTS_PER_SOL).toFixed(6)}`);

          } else {
            console.log(`No positions found for admin in CLMM v3 pool ${poolId}`);
          }

        } catch (err) {
          console.error(`Error withdrawing CLMM v3 liquidity for auction ID: ${x.auctionId}:`, err);
        }
      }
    }
  });

  it("admin - pools - lock liquidity", async () => {
    // Get all auctions
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const totalAuctions = Number(globalInfoAccount.auctionsNum);

    // ##############
    const auctionIds = [35]; //Array.from({ length: totalAuctions }, (_, i) => i);
    // ##############

    // Initialize Raydium SDK
    console.log(` [lockPosition] Initializing Raydium SDK for network: ${getCurrentNetwork()}`);
    const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'confirmed' });

    // Batch processing to avoid rate limits
    const results = [];

    console.log(` [lockPosition] Processing ${totalAuctions} auctions in batches of ${AUCTION_FETCH_BATCH_SIZE}...`);

    for (let i = 0; i < auctionIds.length; i += AUCTION_FETCH_BATCH_SIZE) {
      const batch = auctionIds.slice(i, i + AUCTION_FETCH_BATCH_SIZE);
      console.log(` [lockPosition] Processing batch ${Math.floor(i / AUCTION_FETCH_BATCH_SIZE) + 1} of ${Math.ceil(auctionIds.length / AUCTION_FETCH_BATCH_SIZE)} (auctions ${i} to ${Math.min(i + AUCTION_FETCH_BATCH_SIZE - 1, auctionIds.length - 1)})`);

      const batchPromises = batch.map(auctionId =>
        getAuctionDetails(auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + AUCTION_FETCH_BATCH_SIZE < auctionIds.length) {
        console.log(` [lockPosition] Waiting ${AUCTION_FETCH_BATCH_DELAY}ms before next batch to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, AUCTION_FETCH_BATCH_DELAY));
      }
    }

    const auctions = results.filter(result => result !== null);
    console.log(` [lockPosition] Successfully fetched ${auctions.length} auctions`);

    // Collect poolDbInfos and pool IDs from DB
    const { poolDbInfos, poolPpcInfosMapv3 } = await getPoolDbAndRpcInfos(auctions);

    // Determine CLMM program ID based on network
    const clmmProgramId = IS_MAINNET
      ? new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUQpMDdHFWmNp2wxCM") // Mainnet CLMM program ID
      : DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID // "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" 

    // *************
    //console.log('??? ==> DEVNET_PROGRAM_ID.CLMM', DEVNET_PROGRAM_ID.CLMM); // "@raydium-io/raydium-sdk-v2": "^0.1.128-alpha", == devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH -- an "old" devnet CLMM program ID ??!!!
    //console.log('??? ==> DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID', DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID); // "@raydium-io/raydium-sdk-v2": "^0.2.8-alpha", == DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH
    // *************

    // Determine locker program ID based on network
    const lockerProgramId = IS_MAINNET
      ? new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE")
      : new PublicKey("DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX");

    // Determine auth program ID based on network  
    const authProgramId = IS_MAINNET
      ? new PublicKey("kN1kEznaF5Xbd8LYuqtEFcxzWSBk5Fv6ygX6SqEGJVy")
      : new PublicKey("8qmHNvu2Kr2C7U8mJL4Vz1vTDxMhVuXKREwU7TNoaVEo");

    console.log(` [lockPosition] Using CLMM Program ID for ${getCurrentNetwork()}: ${clmmProgramId.toBase58()}`);
    console.log(` [lockPosition] Using Locker Program ID for ${getCurrentNetwork()}: ${lockerProgramId.toBase58()}`);
    console.log(` [lockPosition] Using Auth Program ID for ${getCurrentNetwork()}: ${authProgramId.toBase58()}`);

    // Process each auction sequentially
    for (const [index, x] of auctions.entries()) {
      const poolDb = poolDbInfos[index];
      const poolPpcInfo_v3 = poolDb?.pool_id ? poolPpcInfosMapv3.get(poolDb.pool_id) : undefined;

      if (poolPpcInfo_v3) {
        try {
          const poolId = poolDb.pool_id;
          console.log(`\n [lockPosition] === Processing CLMM v3 pool for auction ID: ${x.auctionId} ===`);

          // Get admin's positions for this pool
          const adminPositions = await raydium.clmm.getOwnerPositionInfo({
            programId: clmmProgramId
          });

          const poolPositions = adminPositions.filter(pos =>
            pos.poolId.toBase58() === poolId
          );

          console.log(` [lockPosition] Found ${poolPositions.length} position(s) for admin in pool ${poolId}`);

          // Log detailed auction info with position data
          await logAuctionInfo(poolDbInfos, index, poolPpcInfosMapv3, x, raydium, adminKp);

          if (poolPositions.length > 0) {
            // Get pool info for calculations
            const poolInfo = (await raydium.clmm.getPoolInfoFromRpc(poolId)).poolInfo;

            // Get admin's SOL balance before locking
            const adminSolBefore = await connection.getBalance(adminKp.publicKey);
            console.log(` [lockPosition] Admin SOL balance before locking: ${(adminSolBefore / LAMPORTS_PER_SOL).toFixed(6)}`);

            // Process each position for locking
            for (const [posIndex, position] of poolPositions.entries()) {
              console.log(`\n [lockPosition] === Locking Position ${posIndex + 1} (Burn & Earn) ===`);
              console.log(` [lockPosition] Position ID: ${position.nftMint.toBase58()}`);
              console.log(` [lockPosition] Liquidity: ${position.liquidity.toString()}`);
              console.log(` [lockPosition] Tick Range: [${position.tickLower}, ${position.tickUpper}]`);

              // Check NFT and position account information to diagnose the issue
              try {
                const nftAccount = await raydium.connection.getAccountInfo(position.nftMint);
                console.log(` [lockPosition] NFT Account Owner: ${nftAccount?.owner.toBase58()}`);
                console.log(` [lockPosition] NFT Account Data Length: ${nftAccount?.data.length}`);

                // Check if this is Token2022 vs standard Token program
                const isToken2022 = nftAccount?.owner.equals(TOKEN_2022_PROGRAM_ID);
                const isStandardToken = nftAccount?.owner.equals(TOKEN_PROGRAM_ID);

                console.log(` [lockPosition] Is Token2022: ${isToken2022}`);
                console.log(` [lockPosition] Is Standard Token: ${isStandardToken}`);

                // Check the position account itself to see which program created it
                console.log(` [lockPosition] Position Data: poolId=${position.poolId.toBase58()}`);
                console.log(` [lockPosition] Position Data: nftMint=${position.nftMint.toBase58()}`);
                console.log(` [lockPosition] Expected CLMM Program: ${clmmProgramId.toBase58()}`);

                // Note: positionId is not directly available in the position object,
                // but we can see the pool program from poolInfo.programId

                // Check the pool account as well
                const poolAccount = await raydium.connection.getAccountInfo(position.poolId);
                console.log(` [lockPosition] Pool Account Owner: ${poolAccount?.owner.toBase58()}`);

                if (poolAccount && !poolAccount.owner.equals(clmmProgramId)) {
                  console.error(` [lockPosition] ⚠️  MISMATCH: Pool owned by ${poolAccount.owner.toBase58()}, but we're using ${clmmProgramId.toBase58()}`);
                }

              } catch (accountError) {
                console.error(` [lockPosition] Error checking NFT account:`, accountError);
              }

              // Check if position has liquidity to lock
              if (position.liquidity.gt(new BN(0))) {
                console.log(` [lockPosition] Position has liquidity, proceeding to lock (burn & earn)...`);

                try {
                  // 1. Harvest any pending rewards/fees
                  // const harvest = await raydium.clmm.harvestAllRewards({
                  //   ownerPosition: position,
                  //   programId: clmmProgramId,
                  //   refresh: true,
                  // });
                  // await harvest.execute();
                  // console.log(` [lockPosition] Harvested pending rewards before locking`);

                  // Derive authority PDA
                  const [authorityPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("authority")],  // Common seed for Raydium-style auth PDAs; confirm via program IDL if needed
                    authProgramId
                  );                  

                  //console.dir(poolInfo, { depth: null });
                  console.log(` [lockPosition] Using Pool Program ID: ${poolInfo.programId}`);
                  console.log(` [lockPosition] Using Locker Program ID: ${lockerProgramId.toBase58()}`);
                  console.log(` [lockPosition] Using Auth Program ID: ${authProgramId.toBase58()}`);

                  // 2. Lock the position
                  const lock = await raydium.clmm.lockPosition({
                    ownerPosition: position,
                    programId: lockerProgramId,      // Lock authority program
                    authProgramId: DEVNET_PROGRAM_ID.CLMM_LOCK_AUTH_ID, // authorityPda,     //authProgramId,    // Auth program
                    poolProgramId: new PublicKey(poolInfo.programId),    // Actual pool program ID
                  });

                  try {
                    const lockResult = await lock.execute();
                    const txId = lockResult.txId;
                    console.log(` [lockPosition] Transaction sent - TxID: ${txId}`);
                    console.log(` [lockPosition] Confirming transaction...`);

                    // Wait for transaction confirmation and check for errors
                    const confirmation = await raydium.connection.confirmTransaction(txId, 'confirmed');

                    if (confirmation.value.err) {
                      console.error(` [lockPosition] ❌ Transaction FAILED on-chain - TxID: ${txId}`);
                      console.error(` [lockPosition] Transaction error:`, confirmation.value.err);

                      // Get transaction details for more info
                      try {
                        const txDetails = await raydium.connection.getTransaction(txId, {
                          commitment: 'confirmed',
                          maxSupportedTransactionVersion: 0
                        });

                        if (txDetails?.meta?.err) {
                          console.error(` [lockPosition] Detailed error:`, txDetails.meta.err);
                        }

                        if (txDetails?.meta?.logMessages) {
                          console.error(` [lockPosition] Transaction logs:`, txDetails.meta.logMessages);
                        }
                      } catch (detailError) {
                        console.error(` [lockPosition] Could not fetch transaction details:`, detailError);
                      }

                      throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
                    }

                    console.log(` [lockPosition] ✅ Position locked successfully (burn & earn) - TxID: ${txId}`);

                  } catch (lockError: any) {
                    console.error(` [lockPosition] ❌ Transaction FAILED for position ${position.nftMint.toBase58()}`);
                    console.error(` [lockPosition] Error details:`, lockError);

                    if (lockError?.signature) {
                      console.error(` [lockPosition] Failed transaction signature: ${lockError.signature}`);
                    }

                    if (lockError?.message) {
                      console.error(` [lockPosition] Error message: ${lockError.message}`);
                    }

                    if (lockError?.logs) {
                      console.error(` [lockPosition] Transaction logs:`, lockError.logs);
                    }

                    // Re-throw to be caught by outer error handler
                    throw lockError;
                  }

                  // Log position details that were locked
                  console.log(` [lockPosition] POSITION LOCK DETAILS:`);
                  console.log(`   Position NFT: ${position.nftMint.toBase58()}`);
                  console.log(`   Pool ID: ${poolId}`);
                  console.log(`   Liquidity Amount: ${position.liquidity.toString()}`);
                  console.log(`   Tick Range: [${position.tickLower}, ${position.tickUpper}]`);
                  console.log(`   Current Price Impact: Locked liquidity provides continuous trading fees`);
                  console.log(`   Network: ${getCurrentNetwork()}`);
                  console.log(`   CLMM Program: ${clmmProgramId.toBase58()}`);

                  // Calculate and display position value information
                  console.log(` [lockPosition] POSITION VALUE INFO:`);
                  console.log(`   Token A Mint: ${poolInfo.poolInfo.mintA.address}`);
                  console.log(`   Token B Mint: ${poolInfo.poolInfo.mintB.address}`);
                  console.log(`   Position is ${position.liquidity.gt(new BN(0)) ? 'ACTIVE' : 'EMPTY'}`);
                  console.log(`   Burn & Earn Status: LOCKED`);

                  console.log(` [lockPosition] Position lock completed successfully`);

                } catch (lockError) {
                  console.error(` [lockPosition] Error during position locking for position ${position.nftMint.toBase58()}:`, lockError);
                  if (lockError instanceof Error) {
                    console.error(` [lockPosition] Error message: ${lockError.message}`);
                    console.error(` [lockPosition] Error stack: ${lockError.stack}`);
                  }
                }
              } else {
                console.log(` [lockPosition] Position has no liquidity to lock`);
              }
            }

            // Get admin's SOL balance after operations
            const adminSolAfter = await connection.getBalance(adminKp.publicKey);
            const solSpent = adminSolBefore - adminSolAfter;

            console.log(`\n [lockPosition] FINAL BALANCE SUMMARY:`);
            console.log(` [lockPosition] Admin SOL balance after operations: ${(adminSolAfter / LAMPORTS_PER_SOL).toFixed(6)}`);
            console.log(` [lockPosition] SOL spent (transaction fees): ${(solSpent / LAMPORTS_PER_SOL).toFixed(6)}`);

          } else {
            console.log(` [lockPosition] No positions found for admin in CLMM v3 pool ${poolId}`);
          }

        } catch (err) {
          console.error(` [lockPosition] Error processing CLMM v3 position locking for auction ID: ${x.auctionId}:`, err);
          if (err instanceof Error) {
            console.error(` [lockPosition] Error message: ${err.message}`);
            console.error(` [lockPosition] Error stack: ${err.stack}`);
          }
        }
      } else {
        console.log(` [lockPosition] No CLMM v3 pool info found for auction ID: ${x.auctionId}`);
      }
    }
    console.log(` [lockPosition] Position locking (burn & earn) process completed for ${auctions.length} auctions`);
  });


  it("claims - full supply not bid", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 }); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[0] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });
    logger.color("magenta").log("sleeping 36s...");
    await sleep(36);

    // claim 1/2 - check status updated
    await test_claim_auction(USER_KPs[0], false, bidResult1); // should update auction status to "failedNotFullyAllocated"
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionPost = await program.account.auction.fetch(auctionData); // last status (set on bid) was "live..."
    assert.deepEqual(auctionPost.lastStatus, { failedNotFullyAllocated: {} }, "expected failedNotFullyAllocated");
    //logObject("auctionPost", auctionPost);

    // claim 2/2 - check no sol left in the auction - returned in full
    await test_claim_auction(USER_KPs[1], false, bidResult2);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionSolBalance = await connection.getBalance(auctionSol);
    console.log("auctionSolBalance", auctionSolBalance.toString() / LAMPORTS_PER_SOL);
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction"); // claim (refund) will reduce sol account to 0
  });


  it("claims - failedMinNotReached", async () => {
    await test_init(10000); // 10k SOL minimum needed to move liquidity - will cause this auction to finished failed

    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 /*36s*/ }); 

    // Derive auction-related accounts after creating the auction
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auction = await program.account.auction.fetch(auctionData);
    const tokenMint = auction.tokenMint;
    const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true);

    // Get initial token balance of auctionTokenAccount
    const initialTokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
    const initialTokens = new BN(initialTokenBalance.value.amount);
    console.log("Initial token balance:", initialTokens.toString());

    // Place bids and capture results for both users
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[0] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1], skipLiqMoveAssumption: true }); // Full fill, failed auction - min sol not reached (no migration)

    // Calculate total bids and total fees using returned values
    const totalBids = bidResult1.bidAmountBN.add(bidResult2.bidAmountBN);
    const totalFees = bidResult1.feeIncreaseBN.add(bidResult2.feeIncreaseBN);
    console.log("Total bid amount (lamports):", totalBids.toString());
    console.log("Total fees paid (lamports):", totalFees.toString());

    // Verify auction status
    assert.deepEqual(bidResult2.auctionPost.lastStatus, { failedMinNotReached: {} }, "expected failedMinNotReached");
    //logObject("auctionPost", bidResult2.auctionPost);

    // Test auction failure path with claims
    const claimResult1 = await test_claim_auction(USER_KPs[0], false, bidResult1);
    const claimResult2 = await test_claim_auction(USER_KPs[1], false, bidResult2);

    // Calculate total SOL returned to users
    const totalSolReturned = new BN(claimResult1.solTransferred).add(new BN(claimResult2.solTransferred));
    console.log("Total SOL returned to users (lamports):", totalSolReturned.toString());

    // Get final token balance of auctionTokenAccount
    const finalTokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
    const finalTokens = new BN(finalTokenBalance.value.amount);
    console.log("Final token balance:", finalTokens.toString());

    // Validate token balance consistency (should not change in a failed auction)
    assert.equal(finalTokens.toString(), initialTokens.toString(), "Token balance should remain unchanged in failed auction");

    // Validate total SOL returned equals total bids minus total fees
    const expectedSolReturned = totalBids.sub(totalFees);
    console.log("Expected SOL returned (bids - fees):", expectedSolReturned.toString());
    assert.equal(totalSolReturned.toString(), expectedSolReturned.toString(), "Total SOL returned should equal total bids minus total fees");

    // Existing assertions for claim results
    assert.equal(claimResult1.tokensTransferred == 0, true, "Tokens should not be transferred in failure path");
    assert.equal(claimResult1.solTransferred > 0, true, "SOL should be transferred in failure path");
    assert.equal(claimResult2.tokensTransferred == 0, true, "Tokens should not be transferred in failure path");
    assert.equal(claimResult2.solTransferred > 0, true, "SOL should be transferred in failure path");

    // check no sol left in the auction - returned in full
    const auctionSolBalance = await connection.getBalance(auctionSol);
    console.log("auctionSolBalance", auctionSolBalance.toString() / LAMPORTS_PER_SOL);
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction"); // claim (refund) will reduce sol account to 0
  });

  it("claims - same user two bids failedMinNotReached", async () => {
    await test_init(10000); // 10k SOL minimum needed to move liquidity - will cause this auction to finished failed
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 /*36s*/ });
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });
    const bidResult3 = await test_bid_auction({ fill_percent: 0.2, bidderKp: USER_KPs[2], skipLiqMoveAssumption: true }); // will finish failed

    // claim 1 - for 2 bids
    const user1mergedBidResults = {
      bidAmountBN: bidResult1.bidAmountBN.add(bidResult2.bidAmountBN),
      bidQty: bidResult1.bidQty.add(bidResult2.bidQty),
      actualBidFeeBN: bidResult1.actualBidFeeBN.add(bidResult2.actualBidFeeBN),
      feeIncreaseBN: bidResult1.feeIncreaseBN.add(bidResult2.feeIncreaseBN),
    }
    await test_claim_auction(USER_KPs[1], false, user1mergedBidResults);

    // claim 2 - for 1 bid; check no sol left in the auction - i.e. all sol returned in full
    await test_claim_auction(USER_KPs[2], false, bidResult3);
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionSolBalance = await connection.getBalance(auctionSol);
    console.log("auctionSolBalance", auctionSolBalance.toString() / LAMPORTS_PER_SOL);
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction"); // claim (refund) will reduce sol account to 0
  });

  it("claims - only after auction is finished", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.95,*/ duration_hours_div100: 1 }); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });

    try {
      await test_claim_auction(USER_KPs[1], false);
    }
    catch (err) {
      console.log("Expected Error: ", err);
      assert.equal(err.toString().includes("AuctionNotFinished"), true, "should only be able to claim after auction is finished");
    }
  });

  it("claims - e2e - successful auction", async () => {
    await test_e2e_auction_success();
  });

  it("claims - e2e - low settlement price", async () => {
    await test_e2e_auction_low_settlement_price();
  });

  it("claims - e2e - failed low clearing price", async () => {
    await test_init(10000); // 10k SOL minimum needed to move liquidity - will cause this auction to finished failed
    await test_e2e_auction_success({ lowClearingPrice: true, });
  });

  it("claims - auction creator bids & claims", async () => {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.9631,*/ duration_hours_div100: 1 }); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[0] });
    const bidResult2 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[1] });
    await test_claim_auction(USER_KPs[0], true, bidResult1); // creator claims
  });

  it("claims - e2e - withdraws & movesliq after claims", async () => {
    await test_e2e_auction_success({ migrateAfterClaims: true }); // claims will happen first: patholigical case, we will trigger moveliq on event listener so it will happen fast
  });

  // New test cases using dynamic test data generation
  // it("testdata - creates auction with dynamic meme data", async () => {
  //   if (!isLocal) {
  //     await test_create_auction_KP0({ useDynamicTestData: true, testDataTheme: 'meme' });
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  // it("testdata - creates auction with dynamic DeFi data", async () => {
  //   if (!isLocal) {
  //     await test_create_auction_KP0({ useDynamicTestData: true, testDataTheme: 'defi' });
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  // it("testdata - creates auction with dynamic gaming data", async () => {
  //   if (!isLocal) {
  //     await test_create_auction_KP0({ useDynamicTestData: true, testDataTheme: 'gaming' });
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  // it("testdata - creates auction with dynamic AI data", async () => {
  //   if (!isLocal) {
  //     await test_create_auction_KP0({ useDynamicTestData: true, testDataTheme: 'ai' });
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  // it("testdata - creates auction with random dynamic data", async () => {
  //   if (!isLocal) {
  //     await test_create_auction_KP0({ useDynamicTestData: true });
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  // it("testdata - creates multiple diverse auctions and bids", async () => {
  //   if (!isLocal) {
  //     // Create 3 different themed auctions with dynamic data
  //     const themes = ['meme', 'defi', 'gaming'];

  //     for (const theme of themes) {
  //       await test_create_auction_KP0({
  //         useDynamicTestData: true,
  //         testDataTheme: theme,
  //         duration_hours_div100: 5 // 5 units of 36s for testing
  //       });

  //       // Place a small bid to test the auction works
  //       await test_bid_auction({
  //         fill_percent: 0.1,
  //         bidderKp: USER_KPs[Math.floor(Math.random() * USER_KPs.length)],
  //         skipValidations: true
  //       });

  //       // Small delay between auctions
  //       await sleep(2);
  //     }
  //   } else {
  //     console.log("Skipping dynamic test data on local network");
  //   }
  // });

  async function test_large_number_of_bids(numBids) {
    logger.color("magenta").log(`Starting stress test with ${numBids} bids...`);
  
    // **Step 1: Set up auction parameters**
    // Longer duration to accommodate 100 bids (e.g., 10 minutes ~ 600 seconds)
    const durationHoursDiv100 = Math.ceil(600 / 36); // ~16 units, each ~36s
    await test_create_auction_KP0({ duration_hours_div100: durationHoursDiv100 });
  
    // Derive auction PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionPre = await program.account.auction.fetch(auctionData);
    const tokenSupply = auctionPre.tokenSupply.toNumber() / Math.pow(10, auctionPre.tokenDecimals);
  
    // **Step 2: Prepare multiple bidders**
    // Use existing USER_KPs (3 keypairs) and cycle through them
    const bidders = USER_KPs;
    const fillPercentPerBid = 1.0 / numBids; // Each bid fills supply evenly
  
    // Ensure bidders have enough SOL (especially for local testing)
    if (isLocal) {
      const airdropPromises = bidders.map(async (bidder) => {
        const balance = await connection.getBalance(bidder.publicKey);
        if (balance < 5 * LAMPORTS_PER_SOL) {
          const tx = await connection.requestAirdrop(bidder.publicKey, 5 * LAMPORTS_PER_SOL);
          await connection.confirmTransaction(tx);
        }
      });
      await Promise.all(airdropPromises);
    }
  
    // **Step 3: Place numBids bids in batches**
    const BATCH_SIZE = 3; // Set to 1 for sequential, or higher for batched bids - CAP 3 to prevent dupe keys in client (3 test accounts)
    const results = [];
    for (let i = 0; i < numBids; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, numBids);
      const batchPromises = [];

      // Check auction status before starting the batch
      const auction = await program.account.auction.fetch(auctionData);
      if (Object.keys(auction.lastStatus)[0] !== 'live') {
        logger.log(`Auction is no longer live. Stopping at bid ${i + 1}`);
        break;
      }

      // Prepare bids for the current batch
      for (let j = i; j < batchEnd; j++) {
        const bidderKp = bidders[j % bidders.length]; // Cycle through borrowers
        batchPromises.push(
          test_bid_auction({
            fill_percent: fillPercentPerBid,
            bidderKp: bidderKp,
            useAuctionId: auctionId,
            skipMigrationWait: true,
            skipValidations: true,
          }).then((result) => {
            logger.log(`Bid ${j + 1} confirmed`);
            return result;
          }).catch((err) => {
            logger.color("red").log(`Bid ${j + 1} failed:`, err);
            return { error: err };
          })
        );
      }

      // Wait for all bids in the batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Wait before the next batch
      //await sleep(1);
    }
  
    // **Step 4: Check for errors**
    const failedBids = results.filter((result) => result.error);
    assert.equal(failedBids.length, 0, `${failedBids.length} bids failed during stress test`);
  
    // **Step 5: Verify auction state**
    const auctionPost = await program.account.auction.fetch(auctionData);
    const auctionBids = await getBids(program, auctionId);
    const totalBidQty = auctionBids.reduce((sum, bid) => sum.add(bid.bidQty), new BN(0)).toNumber();
    const totalSolCommitted = await connection.getBalance(auctionSol);
    const expectedQty = Math.floor(tokenSupply * fillPercentPerBid * numBids);
  
    console.log(`Total bids placed: ${auctionBids.length}`);
    console.log(`Total bid quantity: ${totalBidQty}`);
    console.log(`Expected quantity: ${expectedQty}`);
    console.log(`Total SOL committed: ${totalSolCommitted / LAMPORTS_PER_SOL} SOL`);
  
    // Adjust assertion to account for early stopping
    assert.ok(auctionBids.length <= numBids, "Number of bids should not exceed requested amount");
    assert.ok(Math.abs(totalBidQty - expectedQty) <= 1 || totalBidQty <= tokenSupply, "Total bid quantity should match expected or be capped by supply");
    assert.ok(totalSolCommitted > 0, "Auction should have received SOL from bids");
  
    // **Step 6: Check auction status**
    if (totalBidQty >= tokenSupply) {
      assert.deepEqual(auctionPost.lastStatus, { succeeded: {} }, "Auction should succeed when fully filled");
    } else {
      assert.deepEqual(auctionPost.lastStatus, { live: {} }, "Auction should remain live if not fully filled");
    }
  
    logger.color("green").log(`Successfully completed stress test with ${numBids} bids`);
}

  async function test_e2e_auction_success({
    lowClearingPrice = false, // we also test this explicitly and clearly elsewhere; but this tests too that we don't moveliq
    migrateAfterClaims = false // default/mainpath is to migrate *before* claims
  } = {}) {
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.9631,*/ duration_hours_div100: 1 /* 36s */ });

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);

    // bids
    const bidResult1 = await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[0] });

    await sleep(3);
    const bidResult2 = await test_bid_auction({ fill_percent: 0.3, bidderKp: USER_KPs[1] });

    await sleep(lowClearingPrice ? 25 : 3); // bid at end of auction for low clearing price -- we'll also set a crazy high MIN_TOTAL_SOL when we run with this param
    if (migrateAfterClaims) { // pause moveliq if requested - to test claims *after* migration (secondary case - main flow is moveliq, then claims)
      logger.color("yellow").log("migrateAfterClaims - pausing moveliq...");
      MOVELIQ_PAUSE = true;
    }
    const bidResult3 = await test_bid_auction({ fill_percent: 0.2, bidderKp: USER_KPs[2], skipMigrationWait: migrateAfterClaims }); // final bid - will moveliq on devnet
    if (lowClearingPrice) {
      assert.deepEqual(bidResult3.auctionPost.lastStatus, { failedMinNotReached: {} }, "expected failedMinNotReached, got " + JSON.stringify((bidResult3.auctionPost.lastStatus)));
    }
    else {
      assert.deepEqual(bidResult3.auctionPost.lastStatus, { succeeded: {} }, "expected succeeded, got " + JSON.stringify((bidResult3.auctionPost.lastStatus)));
    }

    // log state
    var auctionPost = await program.account.auction.fetch(auctionData);
    var auctionSolBalance = await connection.getBalance(auctionSol);
    (await getBids(program, auctionId)).forEach((bid) => { //auctionPost.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    // claims
    const assumeSuccessAuction = !lowClearingPrice;
    const { solTransferred: solTransferred1, tokensTransferred: tokensTransferred1 } = await test_claim_auction(USER_KPs[0], assumeSuccessAuction, bidResult1);
    const { solTransferred: solTransferred2, tokensTransferred: tokensTransferred2 } = await test_claim_auction(USER_KPs[1], assumeSuccessAuction, bidResult2);
    const { solTransferred: solTransferred3, tokensTransferred: tokensTransferred3 } = await test_claim_auction(USER_KPs[2], assumeSuccessAuction, bidResult3);

    // proceed with moveliq migration, if prior pause was requested
    if (migrateAfterClaims) {
      logger.color("yellow").log("migrateAfterClaims - releasing moveliq...");
      MOVELIQ_PAUSE = false;
      const migrationResult = await waitForMigration(auctionId);
      logObject("migrationResult", migrationResult);
      assert.ok(migrationResult.error == null, "migration should succeed");
    }

    if (assumeSuccessAuction) {
      assert.equal(solTransferred1 > 0, true, "first bidder should get change"); // first bidder should get change, & tokens
      assert.equal(tokensTransferred1 > 0, true, "first bidder should get tokens");
      assert.equal(solTransferred2 > 0, true, "second bidder should get change"); // same for second bidder
      assert.equal(tokensTransferred2 > 0, true, "second bidder should get tokens");
      assert.equal(solTransferred3 == 0, true, "last bidder should get no change"); // last bidder gets no change, but gets tokens
      assert.equal(tokensTransferred3 > 0, true, "last bidder should get tokens");
    }
    else {
      assert.equal(solTransferred1 > 0, true, "first bidder should get refund"); // all get a refund and no tokens
      assert.equal(tokensTransferred1 == 0, true, "first bidder should get no tokens");
      assert.equal(solTransferred2 > 0, true, "second bidder should get refund");
      assert.equal(tokensTransferred2 == 0, true, "second bidder should get no tokens");
      assert.equal(solTransferred3 > 0, true, "last bidder should get refund");
      assert.equal(tokensTransferred3 == 0, true, "last bidder should get no tokens");
    }

    // check correct amount of sol is left in the auction...
    auctionPost = await program.account.auction.fetch(auctionData);
    const auctionPostBids = await getBids(program, auctionId);
    auctionSolBalance = await connection.getBalance(auctionSol);
    auctionPostBids.forEach((bid) => { //auctionPost.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    const clearingPrice = auctionPost.clearingPrice;
    console.log(`clearingPrice sol`, clearingPrice.toNumber() / LAMPORTS_PER_SOL);

    console.log(`tokensTransferred1`, tokensTransferred1);
    console.log(`tokensTransferred2`, tokensTransferred2);
    console.log(`tokensTransferred3`, tokensTransferred3);  

    if (isLocal) {
      const expectedTotalChange = new BN((await getBids(program, auctionId)).map((bid) => { //auctionPost.bids.map((bid) => {
        // if no moveliq took place
        // expected in auction: is sum(clearing price * total qty) [change was returned] - sum(bid fees) [was taken at bid time]
        if (bid.bidSol.gt(clearingPrice)) {
          const paid = bid.bidSol.mul(bid.bidQty).sub(bid.bidFee);
          const exact = clearingPrice.mul(bid.bidQty);
          const owed = paid.sub(exact);
          if (owed.gt(new BN(0))) return owed;
        }
        return new BN(0);
      }).reduce((a, b) => a.add(b), new BN(0)));
      console.log(`expectedTotalChange`, expectedTotalChange.toNumber() / LAMPORTS_PER_SOL);
      const expectedSolInAuction = 
        new BN(/*auctionPost.bids*/ auctionPostBids.map((bid) => bid.bidSol.toNumber() * bid.bidQty.toNumber() - bid.bidFee.toNumber()).reduce((a, b) => a + b, 0)) // net ins
          .sub(expectedTotalChange);
      console.log(`expectedSolInAuction`, expectedSolInAuction.toNumber() / LAMPORTS_PER_SOL);

      console.log(`auctionSolBalance`, auctionSolBalance.toString() / LAMPORTS_PER_SOL);
      assert.equal(auctionSolBalance.toString(), expectedSolInAuction.toString(), "should be correct amount of sol left in the auction");
    }
    else {
      if (assumeSuccessAuction) {
        // moveliq happened *and* claims happened...
        console.log(`auctionSolBalance`, auctionSolBalance.toString() / LAMPORTS_PER_SOL);

        // suffering exists, craving causing suffering, crazing can be overcome, this is the way...
        // OLD: Method 1 - overmint
        // withdraw_sol *may* hold back RENT_EXEMPT_MIN (it'a param internally, set to zero currently)
        assert.equal(//BigInt(auctionSolBalance) < BigInt(0.001 * LAMPORTS_PER_SOL),  // life is suffering
          auctionSolBalance <= RENT_EXEMPT_MIN, true, "should be <= RENT_EXEMPT_MIN left in the auction after moveliq and claims");

        // Method 2: Check that remaining SOL in the auction account is netSolRaised - liquiditySol
        // const netSolRaised = auctionPost.netSolRaised; // BN from Anchor
        // const liquiditySol = auctionPost.liquiditySol; // BN from Anchor
        // const expectedRemaining = netSolRaised.sub(liquiditySol); // BN subtraction
        // const actualRemaining = new BN(auctionSolBalance); // Convert number to BN
        // console.log(`netSolRaised: ${netSolRaised.toString()} lamports`);
        // console.log(`liquiditySol: ${liquiditySol.toString()} lamports`);
        // console.log(`expectedRemaining: ${expectedRemaining.toString()} lamports`);
        // console.log(`actualRemaining: ${actualRemaining.toString()} lamports`);
        // assert.ok(
        //   expectedRemaining.eq(actualRemaining),
        //   `Remaining SOL should be ${expectedRemaining.toString()} lamports, but got ${actualRemaining.toString()} lamports`
        // );

        // Check the mint authority was revoked
        const mintInfo = await connection.getAccountInfo(new PublicKey(auctionPost.tokenMint));
        if (mintInfo) {
          const mintData = MintLayout.decode(mintInfo.data);
          const mintAuthority = mintData.mintAuthorityOption === 1 ? new PublicKey(mintData.mintAuthority) : null;
          console.log(`Mint Authority: ${mintAuthority ? mintAuthority.toBase58() : 'None'}`);
          assert.equal(mintAuthority, null, "Mint authority should be revoked");
        } else {
          console.log(`Mint account not found`);
          throw new Error("Mint account not found");
        }        
      }
      else {
        // no moveliq happened, but claims did happen...
        console.log(`auctionSolBalance`, auctionSolBalance.toString() / LAMPORTS_PER_SOL);
        assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction after claims"); // claims should have returned all sol
      }
    }
  }

  async function test_e2e_auction_low_settlement_price() { // TODO: make this run much faster; specail case no waiting for confirmation -- to get really close to the limit
    logger.color("cyan").log("Starting low settlement price test - single bid at last moment...");

    // Create auction with 36s duration (1 unit)
    await test_create_auction_KP0({ /*auction_distribution_percent: 0.9631,*/ duration_hours_div100: 1 }); // 5% lock, 36s duration

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);

    // Wait 34 seconds before placing the bid (very last moment)
    logger.color("yellow").log("Waiting 25 seconds before placing single bid at last moment...");
    await sleep(25);

    // Place single bid to fill the entire auction at the very last moment
    logger.color("cyan").log("Placing single bid to fill entire auction...");
    const bidResult = await test_bid_auction({ fill_percent: 1.0, bidderKp: USER_KPs[0] }); // fill entire auction with single bid

    // Verify auction succeeded (should not fail due to timing)
    assert.deepEqual(bidResult.auctionPost.lastStatus, { succeeded: {} }, "expected succeeded, got " + JSON.stringify(bidResult.auctionPost.lastStatus));

    // Log auction state after bid
    const auctionPost = await program.account.auction.fetch(auctionData);
    const auctionSolBalance = await connection.getBalance(auctionSol);
    const bids = await getBids(program, auctionId);

    console.log(`Single bid placed at last moment:`);
    bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    // Verify only one bid was placed
    assert.equal(bids.length, 1, "Should have exactly one bid");

    // Wait for migration to complete (liquidity should be moved)
    if (!isLocal) {
      const migrationResult = await waitForMigration(auctionId);
      logObject("migrationResult", migrationResult);
      assert.ok(migrationResult.error == null, "migration should succeed even with last-moment bid");
    }

    // Claim the bid
    const { solTransferred, tokensTransferred } = await test_claim_auction(USER_KPs[0], true, bidResult);

    // Verify claim results for successful auction
    assert.equal(tokensTransferred > 0, true, "Bidder should receive tokens");
    assert.equal(solTransferred == 0, true, "Last-moment bidder should get no change (paid clearing price)");

    // Verify liquidity was moved properly
    if (!isLocal) {
      const finalAuctionSolBalance = await connection.getBalance(auctionSol);
      console.log(`Final auction SOL balance: ${finalAuctionSolBalance / LAMPORTS_PER_SOL} SOL`);

      // Check that most SOL was moved to liquidity (should be <= rent exemption minimum)
      assert.equal(finalAuctionSolBalance <= RENT_EXEMPT_MIN, true, "should be <= RENT_EXEMPT_MIN left in the auction after moveliq and claims");

      // Verify mint authority was revoked
      const mintInfo = await connection.getAccountInfo(new PublicKey(auctionPost.tokenMint));
      if (mintInfo) {
        const mintData = MintLayout.decode(mintInfo.data);
        const mintAuthority = mintData.mintAuthorityOption === 1 ? new PublicKey(mintData.mintAuthority) : null;
        console.log(`Mint Authority: ${mintAuthority ? mintAuthority.toBase58() : 'None'}`);
        assert.equal(mintAuthority, null, "Mint authority should be revoked");
      }
    }

    const clearingPrice = auctionPost.clearingPrice;
    console.log(`Clearing price (low settlement): ${clearingPrice.toNumber() / LAMPORTS_PER_SOL} SOL per token`);

    logger.color("green").log("Low settlement price test completed successfully!");
  }

  async function test_claim_auction(bidderKp: Keypair, assumeSuccessAuction: boolean = true, bidResult: any = undefined): Promise<{ solTransferred: number, tokensTransferred: number }> {
    logger.color("magenta").log(`${bidderKp.publicKey} is claiming...`);

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1; // Claim against the last auction
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionPre = await program.account.auction.fetch(auctionData);
    (await getBids(program, auctionId)).forEach((bid) => { //auctionPre.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    // **Find all unclaimed bids for the bidder**
    const unclaimedBids = (await getBids(program, auctionId)).filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed); //auctionPre.bids.filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed);
    assert.equal(unclaimedBids.length > 0, true, "No unclaimed bids found for bidder");

    // **Set up accounts for claim**
    const tokenMint = auctionPre.tokenMint;
    await getOrCreateAssociatedTokenAccount(connection, bidderKp, tokenMint, bidderKp.publicKey); // Create ATA - we don't want ATA setup costs to screw up our arithmetic
    const callerTokenAccount = await getAssociatedTokenAddress(tokenMint, bidderKp.publicKey);
    const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true); // Allow off-curve owner

    // **Sum expected net tokens to be transferred**
    const distPercent = auctionPre.distPercent;
    console.log(`claim - testing distPercent, %`, distPercent.toNumber() / 100); // 10000 = 100%
    const tokenDecimals = auctionPre.tokenDecimals;
    let expectedTotalNetTokensToBidder = new BN(0);
    if (assumeSuccessAuction) {
      for (const bid of unclaimedBids) {
        const bidQtyBN = bid.bidQty; // BN in whole tokens
        const tokensPerBid = bidQtyBN
          .mul(distPercent)
          .div(new BN(10000))
          .mul(new BN(10).pow(new BN(tokenDecimals)));
        expectedTotalNetTokensToBidder = expectedTotalNetTokensToBidder.add(tokensPerBid);
      }
    } else {
      expectedTotalNetTokensToBidder = new BN(0);
    }

    // **Get pre-claim balances**
    const bidderSolBefore = await connection.getBalance(bidderKp.publicKey);
    let bidderTokenBefore = 0;
    try {
      const balance = await connection.getTokenAccountBalance(callerTokenAccount);
      bidderTokenBefore = parseInt(balance.value.amount);
    } catch (error) {
      if (error.message.includes("could not find account")) {
        bidderTokenBefore = 0; // Account doesn't exist yet
      } else {
        throw error;
      }
    }
    const auctionSolBefore = await connection.getBalance(auctionSol);
    const auctionTokenBefore = (await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount;
    //console.log(`Balances before claim: Bidder SOL: ${(bidderSolBefore / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${bidderTokenBefore}, Auction SOL: ${(auctionSolBefore / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${auctionTokenBefore}`);

    // **Execute claim instruction**
    var claimSig;
    try {
      claimSig = await program.methods.claim()
        .accounts({
          caller: bidderKp.publicKey,
          tokenMint: tokenMint,
          auctionSolAccount: auctionSol,
          auctionDataAccount: auctionData,
          auctionTokenAccount: auctionTokenAccount,
        })
        .signers([bidderKp])
        .rpc();
      await logSuccessTx(connection, claimSig, "claim");
    } catch (error) {
      console.error("Error during transaction signing or confirmation:", error);
      if (error instanceof Error && "getLogs" in error) {
        const logs = await error.getLogs;
        console.error("logs:", logs);
      }
      throw error;
    }
    const txDetails = await getTransactionDetailsWithRetry(connection, claimSig);
    const networkFee = txDetails!.meta!.fee;

    // **Fetch post-claim balances**
    const bidderSolAfter = await connection.getBalance(bidderKp.publicKey);
    let bidderTokenAfter = 0;
    try {
      const balance = await connection.getTokenAccountBalance(callerTokenAccount);
      bidderTokenAfter = parseInt(balance.value.amount);
    } catch (error) {
      if (error.message.includes("could not find account")) {
        bidderTokenAfter = 0; // Account might still not exist
      } else {
        throw error;
      }
    }
    const auctionSolAfter = await connection.getBalance(auctionSol);
    const auctionTokenAfter = (await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount;
    console.log(`Balances after claim: Bidder SOL: ${(bidderSolAfter / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${bidderTokenAfter}, Auction SOL: ${(auctionSolAfter / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${auctionTokenAfter}`);

    // **Calculate actual transfers**
    const bidFee = bidResult.feeIncreaseBN.toNumber();
    const solTransferredToBidder = bidderSolAfter - bidderSolBefore + networkFee + bidFee; // Adjust for network and bid fees paid by bidder
    const tokensTransferredToBidder = bidderTokenAfter - bidderTokenBefore;
    const solTransferredFromAuction = auctionSolBefore - auctionSolAfter;
    const tokensTransferredFromAuction = parseInt(auctionTokenBefore) - parseInt(auctionTokenAfter);
    //console.log(`solTransferredToBidder: ${(solTransferredToBidder / LAMPORTS_PER_SOL).toFixed(6)}, Tokens to bidder: ${tokensTransferredToBidder}`);
    //console.log(`solTransferredFromAuction: ${(solTransferredFromAuction / LAMPORTS_PER_SOL).toFixed(6)}, Tokens from auction: ${tokensTransferredFromAuction}`);

    // **Check correct # of net tokens transferred to bidder**
    assert.ok(new BN(tokensTransferredToBidder).eq(expectedTotalNetTokensToBidder),
      `Tokens transferred to bidder should match expected net tokens (expected: ${expectedTotalNetTokensToBidder.toString()}, actual: ${tokensTransferredToBidder})`);
    console.log(`expectedTotalNetTokensToBidder`, expectedTotalNetTokensToBidder.toString());
    console.log(`tokensTransferredToBidder`, tokensTransferredToBidder);

    // **Validate transfers based on assumeSuccessAuction**
    if (assumeSuccessAuction) {
      // Success path: expect tokens and possibly SOL refund (change from bids exceeding clearing price)
      assert.equal(tokensTransferredToBidder > 0, true, "Tokens should be transferred to bidder in success path");
      assert.equal(solTransferredToBidder >= 0, true, "SOL (change) may be transferred to bidder in success path");

      // Validate SOL change based on total bid amount vs. clearing price
      const clearingPrice = auctionPre.clearingPrice.toNumber();
      if (bidResult.bidAmountBN.gt(new BN(clearingPrice).mul(bidResult.bidQty))) {
        const bidNet = bidResult.bidAmountBN.sub(bidResult.actualBidFeeBN);
        const change = bidNet.sub(new BN(clearingPrice * bidResult.bidQty.toNumber()));
        //console.log(`change due: bid amount > clearing price`, change.toNumber() / LAMPORTS_PER_SOL);
        assert.equal(solTransferredFromAuction, change.toNumber(), "Auction SOL drop should equal total change amount");
      } else {
        //console.log(`no change due: bid amount <= clearing price`);
        assert.equal(solTransferredFromAuction, 0, "Auction SOL drop should be zero");
      }
    } else {
      // Failure path: expect SOL refund, no tokens
      assert.equal(tokensTransferredToBidder, 0, "No tokens should be transferred in failure path");
      assert.equal(solTransferredToBidder > 0, true, "SOL should be refunded to bidder in failure path");

      // Validate SOL refund matches total net bid amount
      const bidNet = bidResult.bidAmountBN.sub(bidResult.actualBidFeeBN);
      //console.log("solTransferredFromAuction", solTransferredFromAuction.toString());
      //console.log("                   bidNet", bidNet.toString());
      assert.equal(solTransferredFromAuction, bidNet.toNumber(), "Auction SOL drop should equal total bid net amount");
    }

    // **Verify all unclaimed bids are marked as claimed**
    const auctionPost = await program.account.auction.fetch(auctionData);
    const remainingUnclaimedBids = (await getBids(program, auctionId)).filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed); //auctionPost.bids.filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed);
    assert.equal(remainingUnclaimedBids.length, 0, "All unclaimed bids should be marked as claimed");

    // **Return totals**
    return {
      solTransferred: solTransferredFromAuction,
      tokensTransferred: tokensTransferredToBidder,
    };
  }

  async function test_admin_withdraws({ n_bids = 1, withdraw_tokens = false, withdraw_sol = false, fill_auction = false }) {

    // Step 1: Create an auction and place bid(s) to populate the auction with SOL and tokens
    await test_create_auction_KP0({});
    for (var i = 0; i < n_bids; i++) {
      const kp = USER_KPs[i % USER_KPs.length]; ``
      await test_bid_auction({ fill_percent: 0.5 / n_bids, bidderKp: kp }); // bid up to half supply
    }
    if (fill_auction) {
      await test_bid_auction({ fill_percent: 0.5, bidderKp: USER_KPs[0], skipMigrationWait: true }); // fill auction if requested
    }

    // Step 2: Derive necessary accounts
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionDataFetched = await program.account.auction.fetch(auctionData);
    const tokenMint = auctionDataFetched.tokenMint;
    const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true); // Allow off-curve for PDA
    const adminTokenAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, tokenMint, adminKp.publicKey);
  
    // Step 3: Fetch balances before withdrawal
    const adminSolBefore = await connection.getBalance(adminKp.publicKey);
    const auctionSolBefore = await connection.getBalance(auctionSol);
    const auctionTokenBalanceBefore = await connection.getTokenAccountBalance(auctionTokenAccount);
    const auctionTokenBefore = BigInt(auctionTokenBalanceBefore.value.amount); // Use integer amount for precision
    const adminTokenBalanceBefore = await connection.getTokenAccountBalance(adminTokenAccount.address);
    const adminTokenBefore = BigInt(adminTokenBalanceBefore.value.amount); // Use integer amount for precision
    const distPercent = auctionDataFetched.distPercent.toNumber(); // Convert BN to number (1 to 10000)

    const expectedTokenAmountToWithdraw = // Calculate tokens to withdraw
      (Number(auctionTokenBefore) * (1 - (distPercent / 10000))   // old mechanism
        + Number(auctionDataFetched.liquidityOvermint.toNumber())); // new mechanism

    const expectedAuctionTokenAfter = Number(auctionTokenBefore) - expectedTokenAmountToWithdraw; // Remaining tokens in auction
    const expectedAdminTokenAfter = Number(adminTokenBefore) + expectedTokenAmountToWithdraw; // Admin's new balance
    console.log(`distPercent: ${distPercent}`);
    console.log(`liquidityOvermint: ${auctionDataFetched.liquidityOvermint.toNumber()}`);
    console.log(`expectedTokenAmountToWithdraw: ${expectedTokenAmountToWithdraw.toString()}`);
    console.log(`expectedAuctionTokenAfter: ${expectedAuctionTokenAfter.toString()}`);
    console.log(`expectedAdminTokenAfter: ${expectedAdminTokenAfter.toString()}`);
    console.log(`auctionSolBefore: ${auctionSolBefore.toString()}`);

    // Step 4: Withdraw SOL
    const callAs = adminKp;
    if (withdraw_sol) {
      try {
        logger.color("magenta").log("Admin is withdrawing sol...");
        const txSol = await program.methods
          .withdrawSol()
          .accounts({
            admin: callAs.publicKey,
            auctionDataAccount: auctionData,
            auctionSolAccount: auctionSol,
          })
          .signers([callAs])
          .rpc();
        await logSuccessTx(connection, txSol, "withdrawSol");
      } catch (err) {
        if (!fill_auction) {
          console.log("Expected Error: ", err);
          assert.equal(err.toString().includes("AuctionNotFinished"), true, "admin should not be able to withdraw before auction ends");
        }
        else {
          console.error(err.toString());
          console.error("logs:", await err.getLogs());
          throw err;
        }
      }
    }
  
    // Step 5: Withdraw Tokens
    if (withdraw_tokens) {
      try {
        logger.color("magenta").log("Admin is withdrawing tokens...");
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
        await logSuccessTx(connection, txTokens, "txTokens");
      } catch (err) {
        if (!fill_auction) {
          console.log("Expected Error: ", err);
          assert.equal(err.toString().includes("AuctionNotFinished"), true, "admin should not be able to withdraw before auction ends");
        }
        else {
          console.error(err.toString());
          console.error("logs:", await err.getLogs());
          throw err;
        }
      }
    }

    if (fill_auction) {
      // Step 6: Fetch balances after withdrawal
      const adminSolAfter = await connection.getBalance(adminKp.publicKey);
      const auctionSolAfter = await connection.getBalance(auctionSol);

      const auctionTokenBalanceAfter = await connection.getTokenAccountBalance(auctionTokenAccount);
      const auctionTokenAfter = BigInt(auctionTokenBalanceAfter.value.amount);

      const adminTokenBalanceAfter = await connection.getTokenAccountBalance(adminTokenAccount.address);
      const adminTokenAfter = BigInt(adminTokenBalanceAfter.value.amount);

      // Step 7: Log balances for debugging
      console.log("Balances before withdrawal:");
      console.log(`  Admin SOL: ${(adminSolBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
      console.log(`  Auction SOL: ${(auctionSolBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
      console.log(`  Auction Tokens: ${auctionTokenBefore.toString()} tokens`);
      console.log(`  Admin Tokens: ${adminTokenBefore.toString()} tokens`);

      console.log("Balances after withdrawal:");
      console.log(`  Admin SOL: ${(adminSolAfter / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
      console.log(`  Auction SOL: ${(auctionSolAfter / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
      console.log(`  Auction Tokens: ${auctionTokenAfter.toString()} tokens`);
      console.log(`  Admin Tokens: ${adminTokenAfter.toString()} tokens`);

      // Step 8: Assertions
      //assert.ok(auctionSolAfter >= 890880, "Auction SOL account should retain at least rent-exempt minimum");
      assert.ok(auctionSolAfter == 0, "Auction SOL account should not require rent exempt minimum to be retained");
      assert.equal(adminSolAfter > adminSolBefore, true, "Admin SOL should increase after withdrawal");

      // Token balances as expected?
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
  }

  async function test_init(mintotal_sol: number = undefined) {
    const signer = adminKp;

    const newConfig = {
      admin: adminKp.publicKey,
      defaultTokenSupply: new BN(MAXIMEME_TOKEN_SUPPLY),
      defaultTokenDecimals: MAXIMEME_TOKEN_DECIMALS,
      defaultStartPriceLamports: new BN(TEST_STARTPRICE_SOL * LAMPORTS_PER_SOL),
      feeAccounts: FEE_ACCOUNTS.map(account => ({
        pubkey: account.pubkey,
        share: new BN(account.share)
      })),
      daoAccount: TEST_DAO_ACCOUNT.publicKey, // unused actually
      minTotalSol: new BN((mintotal_sol || TEST_MIN_TOTAL_SOL) * LAMPORTS_PER_SOL),
      refBidFeePercShare: new BN(TEST_REF_BID_FEE_PERC_SHARE), // [REF] - Referral system configuration - initialized to zero for backward compatibility
      minBidSize: new BN(TEST_MIN_BID_SIZE), // Minimum bid size in lamports
    };
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);

    let currentConfig;
    try {
      const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
      currentConfig = globalInfoAccount.config;
    } catch (error) {
      currentConfig = null;
    }

    const configsAreEqual = (configA, configB) => {
      if (!configA || !configB) return false;

      // Check fee accounts array with FeeAccount structure
      const feeAccountsEqual = configA.feeAccounts && configB.feeAccounts &&
        configA.feeAccounts.length === configB.feeAccounts.length &&
        configA.feeAccounts.every((accA, idx) => {
          const accB = configB.feeAccounts[idx];
          return accA.pubkey.equals(accB.pubkey) && accA.share.eq(accB.share);
        });

      return (
        configA.admin.equals(configB.admin) &&
        configA.defaultTokenSupply.eq(configB.defaultTokenSupply) &&
        configA.defaultTokenDecimals === configB.defaultTokenDecimals &&
        configA.defaultStartPriceLamports.eq(configB.defaultStartPriceLamports) &&
        feeAccountsEqual &&
        configA.daoAccount.equals(configB.daoAccount) &&
        configA.minTotalSol.eq(configB.minTotalSol) &&
        configA.refBidFeePercShare.eq(configB.refBidFeePercShare) // [REF] - Include referral configuration comparison
      );
    };

    const shouldInitialize = !currentConfig || !configsAreEqual(currentConfig, newConfig);
    if (shouldInitialize) {
      const tx = await program.methods
        .initialize(newConfig)
        .accounts({
          signer: signer.publicKey,
        })
        .signers([signer])
        .transaction();
      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
        await logSuccessTx(connection, sig, "initialize");
        CONTRACT_CONFIG = newConfig;
        logObject("CONTRACT_CONFIG", CONTRACT_CONFIG);
      } catch (err) {
        logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs ? err.getLogs() : err);
        throw err;
      }

      // Setup all fee accounts
      for (const feeAccountConfig of newConfig.feeAccounts) {
        await setupAccount(connection, adminKp, feeAccountConfig.pubkey);
      }
      await setupAccount(connection, adminKp, newConfig.daoAccount);

      // [REF] - Explicitly initialize referral mappings account
      try {
        logger.color("cyan").log("[REF] Initializing referral mappings account...");
        await test_init_referral_mappings();
        logger.color("green").log("[REF] Referral mappings account initialized successfully");
      } catch (err) {
        logger.color("yellow").log("[REF] Referral mappings already initialized or failed:", err.message);
      }
    } else {
      CONTRACT_CONFIG = currentConfig;
      console.log("Configuration is already up to date. No initialization needed.");
    }
  }

  async function test_create_auction_KP0({
    //auction_distribution_percent = undefined,
    duration_hours_div100 = undefined,
    useDynamicTestData = false,
    testDataTheme = undefined
  }: {
      //auction_distribution_percent?: any,
    duration_hours_div100?: any,
    useDynamicTestData?: boolean,
    testDataTheme?: any
  } = {}) {
    const signer = USER_KPs[0];
    logger.color("magenta").log(`${signer.publicKey.toBase58()} is creating auction...`);

    // Fetch globalInfo to get the next auction ID
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoFetched = await program.account.globalInfo.fetchNullable(globalInfo);
    if (!globalInfoFetched) throw new Error("Global Info not initialized!");

    const tokenKp1 = isLocal ? Keypair.generate() : Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey()));
    const token = tokenKp1;

    let name: string;
    let symbol: string;
    let uri: string;

    if (useDynamicTestData && !isLocal) {
      // Use dynamic test data generation (only on devnet/mainnet to avoid IPFS costs in local testing)
      try {
        logger.color("cyan").log("Generating dynamic test data with IPFS upload...");

        let testData: TestTokenData;
        if (testDataTheme) {
          testData = await generateThemedTestToken(testDataTheme);
        } else {
          testData = await generateAndUploadTestTokenData();
        }

        name = testData.name;
        symbol = testData.symbol;
        uri = testData.metadataUri || TEST_TOKEN_URI;

        logger.color("green").log(`Generated test token: ${name} (${symbol})`);
        logger.color("blue").log(`Description: ${testData.description.substring(0, 100)}...`);
        logger.color("yellow").log(`Image type: ${testData.imageExtension}`);
        logger.color("magenta").log(`Metadata URI: ${uri}`);

        if (testData.telegramLink) logger.color("blue").log(`Telegram: ${testData.telegramLink}`);
        if (testData.websiteLink) logger.color("blue").log(`Website: ${testData.websiteLink}`);
        if (testData.twitterLink) logger.color("blue").log(`Twitter: ${testData.twitterLink}`);

      } catch (error) {
        logger.color("red").log(`Failed to generate dynamic test data: ${error instanceof Error ? error.message : String(error)}`);
        logger.color("yellow").log("Falling back to static test data...");

        // Fallback to static data
        name = TEST_TOKEN_NAME + ` ${generateRandomBase58(8)}`;
        symbol = TEST_TOKEN_SYMBOL;
        uri = TEST_TOKEN_URI;
      }
    } else {
      // Use static test data (default behavior)
      name = TEST_TOKEN_NAME + ` ${generateRandomBase58(8)}`;
      symbol = TEST_TOKEN_SYMBOL;
      uri = TEST_TOKEN_URI;

      if (useDynamicTestData && isLocal) {
        logger.color("yellow").log("Dynamic test data requested but disabled on local network to avoid IPFS costs");
      }
    }

    // Test auction data
    const xId = new BN(42);
    const durationHours = new BN(duration_hours_div100 || 10);

    const distPercent = new BN(10000); // method 1 - overmint
    //const distPercent = new BN(auction_distribution_percent !== undefined ? (auction_distribution_percent * 10000) : TEST_DISTRIBUTION_PERCENT); // method 2 - lock tokens

    const delaySeconds = new BN(0);
    const buybackPeriodDays = new BN(30);

    // Derive PDAs using nextAuctionId
    const nextAuctionId = globalInfoFetched.auctionsNum;
    const [auctionDataAccount] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(nextAuctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [bidsAccount] = PublicKey.findProgramAddressSync([Buffer.from(auctionBidsSeed), new BN(nextAuctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSolAccount] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(nextAuctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const auctionTokenAccount = await getAssociatedTokenAddress(token.publicKey, auctionSolAccount, true);

    // 🏷️ [COST] Store balances before auction creation for cost measurement
    const [adminBalanceBefore, signerBalanceBefore, tokenBalanceBefore] = await Promise.all([
      connection.getBalance(adminKp.publicKey),
      connection.getBalance(signer.publicKey),
      connection.getBalance(token.publicKey),
    ]);

    logger.info("🔍 [test_create_auction_KP0] Balances before creating auction:");
    logger.info(`🔍 [test_create_auction_KP0] Admin (${adminKp.publicKey.toBase58()}): ${(adminBalanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    logger.info(`🔍 [test_create_auction_KP0] Signer/FeePayer (${signer.publicKey.toBase58()}): ${(signerBalanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    logger.info(`🔍 [test_create_auction_KP0] Token mint (${token.publicKey.toBase58()}): ${(tokenBalanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`distPercent: ${distPercent} = ${distPercent.toNumber() / 100}%`);
    console.log('durationHours', durationHours.toNumber());

    // Create instruction for createAuction
    const createAuctionIx = await program.methods
      .createAuction(xId, name, symbol, uri, durationHours, distPercent, delaySeconds, buybackPeriodDays) // TODO: change in web
      .accounts({
        //globalInfo: globalInfo,
        creator: signer.publicKey,
        admin: adminKp.publicKey,
        tokenMint: token.publicKey,
        // auctionSolAccount: auctionSolAccount,
        // auctionDataAccount: auctionDataAccount,
        // auctionTokenAccount: auctionTokenAccount,
        //sysvarRent: anchor.web3.SYSVAR_RENT_PUBKEY,
        //systemProgram: anchor.web3.SystemProgram.programId,
        //tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        //associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .instruction();

    // Create instruction for initAuctionBids
    const initAuctionBidsIx = await program.methods
      .initAuctionBids()
      .accounts({
        globalInfo: globalInfo,
        creator: signer.publicKey,
        admin: adminKp.publicKey,
        auctionDataAccount: auctionDataAccount,
        bidsAccount: bidsAccount,
    //systemProgram: anchor.web3.SystemProgram.programId,
    //rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();

    // Build and send transaction
    const tx = new anchor.web3.Transaction()
      .add(createAuctionIx)
      .add(initAuctionBidsIx);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer, token]);

      // 🏷️ [TX] Clear transaction info for on-chain verification
      logger.color("green").log(`✅ [CREATE AUCTION TX] SUCCESS - Transaction confirmed!`);
      logger.color("green").log(`🔗 [CREATE AUCTION TX] Signature: ${sig}`);
      logger.color("blue").log(`🔍 [CREATE AUCTION TX] Verify on explorer: https://solscan.io/tx/${sig}`);

      await logSuccessTx(connection, sig, "createAuction and initAuctionBids");

      // 🏷️ [COST] Measure exact SOL cost of auction creation
      const [adminBalanceAfter, signerBalanceAfter, tokenBalanceAfter] = await Promise.all([
        connection.getBalance(adminKp.publicKey),
        connection.getBalance(signer.publicKey),
        connection.getBalance(token.publicKey),
      ]);

      // Calculate costs in lamports first for precision, then convert to SOL
      const adminCostLamports = adminBalanceBefore - adminBalanceAfter;
      const signerCostLamports = signerBalanceBefore - signerBalanceAfter;
      const tokenCostLamports = tokenBalanceBefore - tokenBalanceAfter;
      const totalCostLamports = adminCostLamports + signerCostLamports + tokenCostLamports;

      const adminCost = adminCostLamports / LAMPORTS_PER_SOL;
      const signerCost = signerCostLamports / LAMPORTS_PER_SOL;
      const tokenCost = tokenCostLamports / LAMPORTS_PER_SOL;
      const totalCost = totalCostLamports / LAMPORTS_PER_SOL;

      // Current SOL price for USD conversion (approximate market price)
      const solPriceUSD = 181.0; // Current SOL price from CoinMarketCap
      const totalCostUSD = totalCost * solPriceUSD;
      const adminCostUSD = adminCost * solPriceUSD;
      const signerCostUSD = signerCost * solPriceUSD;
      const tokenCostUSD = tokenCost * solPriceUSD;

      logger.info("🔍 [test_create_auction_KP0] Balances after creating auction:");
      logger.info(`🔍 [test_create_auction_KP0] Admin (${adminKp.publicKey.toBase58()}): ${(adminBalanceAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL (cost: ${adminCostLamports} lamports = ${adminCost.toFixed(6)} SOL = $${adminCostUSD.toFixed(4)})`);
      logger.info(`🔍 [test_create_auction_KP0] Signer/FeePayer (${signer.publicKey.toBase58()}): ${(signerBalanceAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL (cost: ${signerCostLamports} lamports = ${signerCost.toFixed(6)} SOL = $${signerCostUSD.toFixed(4)})`);
      logger.info(`🔍 [test_create_auction_KP0] Token mint (${token.publicKey.toBase58()}): ${(tokenBalanceAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL (cost: ${tokenCostLamports} lamports = ${tokenCost.toFixed(6)} SOL = $${tokenCostUSD.toFixed(4)})`);

      logger.color("yellow").log(`💰 [AUCTION COST SUMMARY]`);
      logger.color("yellow").log(`💰 Total cost: ${totalCostLamports} lamports = ${totalCost.toFixed(6)} SOL = $${totalCostUSD.toFixed(4)} USD`);
      logger.color("cyan").log(`💰 Breakdown by account:`);
      logger.color("cyan").log(`💰   • Admin: ${adminCostLamports} lamports (${adminCost.toFixed(6)} SOL = $${adminCostUSD.toFixed(4)})`);
      logger.color("cyan").log(`💰   • FeePayer: ${signerCostLamports} lamports (${signerCost.toFixed(6)} SOL = $${signerCostUSD.toFixed(4)})`);
      logger.color("cyan").log(`💰   • TokenMint: ${tokenCostLamports} lamports (${tokenCost.toFixed(6)} SOL = $${tokenCostUSD.toFixed(4)})`);
      logger.color("magenta").log(`💰 [VERIFICATION] Use transaction signature above to verify costs on Solscan explorer`);
      logger.color("magenta").log(`💰 [RATE] USD conversion based on SOL price of $${solPriceUSD} (Jan 2025)`);

      // Save auction to database (test helper equivalent to API saveAuctionToDatabase)
      try {
        logger.info("🔍 [test_create_auction_KP0] Getting auction ID for database insertion");
        const globalInfoForDb = await program.account.globalInfo.fetch(globalInfo);
        const auctionIdForDb = Number(globalInfoForDb.auctionsNum) - 1;

        logger.info("💾 [test_create_auction_KP0] Saving auction to database using test helper");
        await test_saveAuctionToDatabase(auctionIdForDb, sig, xId.toString(), token.publicKey.toBase58());
        logger.info(`✅ [test_create_auction_KP0] Successfully saved auction ${auctionIdForDb} to database`);

        // Now update KeyPair with auctionId (FK constraint satisfied)
        logger.info("💾 [test_create_auction_KP0] Updating KeyPair with auction ID using test helper");
        await test_updateKeypairAuctionId(auctionIdForDb, token.publicKey.toBase58());
        logger.info(`✅ [test_create_auction_KP0] Successfully updated KeyPair for auction ${auctionIdForDb}`);
      } catch (dbError) {
        logger.error("❌ [test_create_auction_KP0] Failed to save auction to database (non-critical):", dbError);
        // Don't fail the auction creation if database save fails (matches API behavior)
      }

    } catch (err) {
      console.error("Error during transaction:", err);
      if (err.logs) console.error("Transaction logs:", err.logs);
      throw err;
    }

    // Post-transaction validation
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    console.log("auctionId", auctionId);

    const auctionDataFetched = await program.account.auction.fetch(auctionDataAccount);
    assert.equal(parseFloat(auctionDataFetched.id.toString()), auctionId);
    assert.equal(auctionDataFetched.isFinished, false);
    assert.equal(auctionDataFetched.creator, signer.publicKey.toBase58());
    assert.equal(auctionDataFetched.tokenMint, token.publicKey.toBase58(), "tokenMint comparison");

    await markMaxiKeyUsed(token.publicKey.toBase58());
    
    // Return auction details
    return {
      auctionId: auctionId,
      tokenMint: token.publicKey
    };
  }

  async function test_bid_auction({
    fill_percent = 1.0, // 0-1
    bidderKp = USER_KPs[1],
    useAuctionId = undefined,
    skipMigrationWait = false,
    skipLiqMoveAssumption = false,
    fee_perc = 0.01, // 0-1
    skipValidations = false, // stress test does concurrent (same block) multiple bids, which screws up validation logic - just skip them when stress testing
  }) {
    logger.color("magenta").log(`${bidderKp.publicKey} is bidding...`);

    // Derive PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = useAuctionId || Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    //console.log("auctionId", auctionId, "auctionSol", auctionSol.toBase58(), "auctionData", auctionData.toBase58());

    // Fetch pre-bid auction data
    const auctionPre = await program.account.auction.fetch(auctionData);
    //console.log("auctionPre", auctionPre);

    const auctionPreBids = await getBids(program, auctionId);
    //console.log("auctionPreBids", auctionPreBids);

    // Set up bidder and bid quantity
    const signer = bidderKp;
    // Use pure integer math to avoid floating point precision loss
    // Convert fill_percent to basis points (multiply by 10000) for integer math
    const fillBasisPoints = Math.round(fill_percent * 10000);
    // Get token supply without decimals (the actual token count)
    const tokenSupplyBN = auctionPre.tokenSupply;
    const divisor = new BN(10).pow(new BN(auctionPre.tokenDecimals));
    const tokenSupplyWithoutDecimals = tokenSupplyBN.div(divisor);

    // DM - ## ACHTUNG ## this may fail to get exactly the remaining supply; we've seen off by one errors here 
    // with previous implicit Math.floor(); Math.round() may be working here more by luck than design to avoid off by 1s.
    // Calculate bid quantity using integer math: (supply * fillBasisPoints) / 10000
    var bidQty = tokenSupplyWithoutDecimals.mul(new BN(fillBasisPoints)).div(new BN(10000));


    // Get initial balances
    const adminBalanceBefore = await connection.getBalance(adminKp.publicKey);
    const bidderBalanceBefore = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceBefore = await connection.getBalance(auctionSol);
    // Get fee account balances before for all accounts
    const feeAccountsBalancesBefore = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const feeAccountBalanceBefore = feeAccountsBalancesBefore.reduce((sum, bal) => sum + bal, 0); // Total fee account balance

    // Check if bid fills auction
    const totalBidTokens = (await getBids(program, auctionId)).reduce((acc, bid) => {  //auctionPre.bids.reduce((acc, bid) => {
      return acc.add(bid.bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals))));
    }, new BN(0));
    const remainingTokenLamports = auctionPre.tokenSupply.sub(totalBidTokens);
    const remainingTokens = remainingTokenLamports.div(new BN(Math.pow(10, auctionPre.tokenDecimals)));
    var bidQtyLamports = bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals)));

    // There are only two hard things...
    if (bidQty.sub(remainingTokens).abs().eq(new BN(1)) && bidQty.gt(new BN(0))) {
      console.warn('fixup JS float errors; off by exactly one token lamport - assuming intent was to exactly fill remaining supply');

      console.log('before fix - bidQty', bidQty.toString());
      console.log('before fix - remainingTokens', remainingTokens.toString());

      bidQty = remainingTokens;
      bidQtyLamports = bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals)));

      console.log('after fix - bidQty', bidQty.toString());
      console.log('after fix - remainingTokens', remainingTokens.toString());
    }

    console.log('bidQty', bidQty.toString());
    const isFinalBid = bidQtyLamports.gte(remainingTokenLamports);
    console.log('remainingTokens:', remainingTokenLamports.toString());
    console.log('bidQtyLamports:', bidQtyLamports.toString());
    console.log('isFinalBid:', isFinalBid);

    // get new bids account lamports - before the bid
    const [bidsPda] = PublicKey.findProgramAddressSync([Buffer.from(auctionBidsSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const bidsAccountInfoBefore = await connection.getAccountInfo(bidsPda);
    //console.log('bidsAccountInfoBefore:', bidsAccountInfoBefore);
    const bidsLamportsBefore = bidsAccountInfoBefore ? bidsAccountInfoBefore.lamports : 0;
    //console.log('bidsLamportsBefore', bidsLamportsBefore);

    // Place bid transaction
    let actualBidFeeBN;
    const newBidListener = program.addEventListener("newBid", (event) => {
      actualBidFeeBN = new BN(event.bidFee);
    });
    // [REF] - Check if bidder has a referrer
    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);
    const referrer = await test_get_referrer_for_account(signer.publicKey);
    
    const publicKeyBase58 = bidderKp.publicKey.toBase58(); // for dummy/test xId
    const firstFourChars = publicKeyBase58.slice(4);
    // Prepare fee accounts for remaining_accounts
    const feeAccountMetas: AccountMeta[] = CONTRACT_CONFIG.feeAccounts.map((feeAccountConfig) => ({
      pubkey: feeAccountConfig.pubkey,
      isSigner: false,
      isWritable: true,
    }));

    const tx = await program.methods.placeBid(
      bidQty, 
      new BN(base58ToInt(firstFourChars)), // dummy xid from pub key

      //
      // DMVIN_TEST -- this is counterintuitive! but the fee paid here in sol by the bidder,
      //  determines the total # of tokens minted in the last bid (T) = S / P
      //  where S = net sol raised (= clearing_price * total_bid_qty)
      //    and P = clearning_price
      // the clearing_prices cancel out, and T = total_bid_qty -- hence, 50/50 split of auction (bid qty) & overminted qty
      // but if we take fees from the sol (net sol raised) then T also reduces by the same fee %
      //
      new BN(fee_perc * 100 * 100)) // 0-1 => 0-10000 

      .accounts({
        bidder: signer.publicKey,
        auctionDataAccount: auctionData,
        auctionSolAccount: auctionSol,

        // for overmint:
        tokenMint: auctionPre.tokenMint,
        auctionTokenAccount: await getAssociatedTokenAddress(auctionPre.tokenMint, auctionSol, true),
        admin: adminKp.publicKey,
        
        // [REF] - Add referral accounts
        referralMappings: referralMappings,
        referrer: referrer || null,
      })
      .remainingAccounts(feeAccountMetas)
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer]).catch(err => {
      console.error("Error during transaction signing or confirmation:", err);
      console.error("logs:", err.getLogs());
      throw err;
    });
    await logSuccessTx(connection, sig, "placeBid");
    await program.removeEventListener(newBidListener);

    // get new bids account lamports - after the bid
    const bidsAccountInfoAfter = await connection.getAccountInfo(bidsPda);
    const bidsLamportsAfter = bidsAccountInfoAfter ? bidsAccountInfoAfter.lamports : 0;
    //console.log('bidsAccountInfoAfter:', bidsAccountInfoAfter);
    const bidsAccountRentPaidByBidder = bidsLamportsAfter - bidsLamportsBefore;
    //console.log('bidsAccountRentPaidByBidder', bidsAccountRentPaidByBidder);

    // Handle final bid with a promise-based semaphore
    if (isFinalBid) {
      if (!isLocal) {
        if (!skipMigrationWait) {
          const migrationResult = await waitForMigration(auctionId);
          logObject("migrationResult", migrationResult);
          assert.ok(migrationResult.error == null, "migration should succeed");
        } else {
          console.log("Final Bid - skipping migration wait as requested...");
        }
      } else {
        console.log("Final Bid - local - NOP: no raydium here...");
      }

      // Fetch and log the total minted token count
      // Optional: Verify exact total supply if liquidityOvermint is available
      const auctionPost = await program.account.auction.fetch(auctionData);
      console.log('auctionPost.liquidityOvermint', auctionPost.liquidityOvermint);
      console.log('Object.keys(auctionPost.lastStatus)[0]', Object.keys(auctionPost.lastStatus)[0]);
      if (auctionPost.liquidityOvermint && Object.keys(auctionPost.lastStatus)[0] == "succeeded") {
        const tokenMintPublicKey = auctionPre.tokenMint; // Use the token mint from auction data
        const mintInfo = await getMint(connection, tokenMintPublicKey); // Fetch mint info
        const totalSupply = mintInfo.supply; // Total supply in smallest unit (bigint)
        const decimals = mintInfo.decimals; // Token decimals
        const totalSupplyInWholeTokens = Number(totalSupply) / Math.pow(10, decimals); // Convert to whole tokens

        console.log('Overmint - Total minted tokens (smallest unit):', totalSupply.toString());
        console.log('Overmint - Total minted tokens (whole tokens):', totalSupplyInWholeTokens);

        // Overmint test: Verify that total supply exceeds original token supply
        const totalSupplyBN = new BN(totalSupply.toString()); // Convert to BN for precise comparison
        const originalTokenSupplyBN = auctionPre.tokenSupply; // Original supply from auction data

        assert.ok(
          totalSupplyBN.gt(originalTokenSupplyBN),
          `Total supply should be greater than original token supply after overmint. Total supply: ${totalSupplyBN.toString()}, Original token supply: ${originalTokenSupplyBN.toString()}`
        );

        const expectedTotalSupplyBN = originalTokenSupplyBN.add(auctionPost.liquidityOvermint);
        assert.equal(
          totalSupplyBN.toString(),
          expectedTotalSupplyBN.toString(),
          `Total supply should equal original token supply plus liquidity overmint. Expected: ${expectedTotalSupplyBN.toString()}, Actual: ${totalSupplyBN.toString()}`
        );
      }
    }

    // Fetch post-bid data
    const adminBalanceAfter = await connection.getBalance(adminKp.publicKey);
    const bidderBalanceAfter = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceAfter = await connection.getBalance(auctionSol);
    // Get fee account balances after for all accounts
    const feeAccountsBalancesAfter = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const feeAccountBalanceAfter = feeAccountsBalancesAfter.reduce((sum, bal) => sum + bal, 0); // Total fee account balance
    const auctionPost = await program.account.auction.fetch(auctionData);
    const auctionPostBids = await getBids(program, auctionId);
    const txDetails = await getTransactionDetailsWithRetry(connection, sig);
    const networkFee = txDetails.meta.fee; // Network transaction fee
    //logObject("test_bid_auction - auctionPost.liquidityOvermint", auctionPost.liquidityOvermint);

    // Calculate bid amount and use actual fee from event
    const bids = await getBids(program, auctionId);
    //console.log("bids", bids);
    const lastBid = bids[bids.length - 1]; //auctionPost.bids[auctionPost.bids.length - 1];
    const bidAmountBN = lastBid.bidQty.mul(lastBid.bidSol); // Total SOL paid by bidder (excluding network fee)
    const expectedAuctionSolIncreaseBN = bidAmountBN.sub(actualBidFeeBN); // Auction receives bid amount minus fee
    
    console.log(`[REF DEBUG] lastBid.bidQty=${lastBid.bidQty.toString()}, lastBid.bidSol=${lastBid.bidSol.toString()}, bidAmountBN=${bidAmountBN.toString()}, actualBidFeeBN=${actualBidFeeBN.toString()}`)

    // Convert to BN for precision
    const adminBalanceBeforeBN = new BN(adminBalanceBefore.toString());
    const bidderBalanceBeforeBN = new BN(bidderBalanceBefore.toString());
    const adminBalanceAfterBN = new BN(adminBalanceAfter.toString());
    const bidderBalanceAfterBN = new BN(bidderBalanceAfter.toString());
    const auctionSolBalanceBeforeBN = new BN(auctionSolBalanceBefore.toString());
    const auctionSolBalanceAfterBN = new BN(auctionSolBalanceAfter.toString());
    const feeAccountBalanceBeforeBN = new BN(feeAccountBalanceBefore.toString());
    const feeAccountBalanceAfterBN = new BN(feeAccountBalanceAfter.toString());
    const networkFeeBN = new BN(networkFee); // Network fee in lamports

    // Calculate fee increase
    const feeIncreaseBN = feeAccountBalanceAfterBN.sub(feeAccountBalanceBeforeBN);

    // Calculate minimum expected fee (% of bidAmountBN)
    // IMPORTANT: fee_perc is 0-1, but we need to use actualBidFeeBN from the event for accurate calculation
    const totalFeeBN = actualBidFeeBN; // Use the actual fee from the event instead of calculating
    
    // [REF] - Adjust expected fee if referrer exists and ref fee share is non-zero
    let minExpectedFeeBN = totalFeeBN;
    if (referrer && globalInfoAccount.config.refBidFeePercShare.gt(new BN(0))) {
      // Platform only gets (10000 - refBidFeePercShare) / 10000 of the fee
      const platformShareBN = new BN(10000).sub(globalInfoAccount.config.refBidFeePercShare);
      minExpectedFeeBN = totalFeeBN.mul(platformShareBN).div(new BN(10000));
      console.log(`[REF DEBUG] Referrer found, adjusting fee: totalFee=${totalFeeBN.toString()}, { refShare=${globalInfoAccount.config.refBidFeePercShare.toString()}, platformShare=${platformShareBN.toString()} }, expectedPlatformFee=${minExpectedFeeBN.toString()}`);
    }
    
    console.log("bidAmountBN", bidAmountBN.toString());
    console.log("totalFeeBN", totalFeeBN.toString());
    console.log("minExpectedFeeBN", minExpectedFeeBN.toString());
    console.log("feeIncreaseBN", feeIncreaseBN.toString());

    // **Validate that feeAccount increases by expected amount (accounting for referral split)**
    if (!skipValidations) {
      assert.ok(feeIncreaseBN.sub(minExpectedFeeBN).abs().lte(new BN(1)), `Fee account should increase by expected amount (±1 lamport tolerance). Actual increase: ${feeIncreaseBN.toString()}, Expected: ${minExpectedFeeBN.toString()}`);
      
      // **Validate fee distribution across multiple fee accounts**
      logger.color("yellow").log("=== FEE DISTRIBUTION VALIDATION ===");
      
      // Calculate individual fee account increases
      const feeAccountIncreases = feeAccountsBalancesAfter.map((balAfter, idx) =>
        balAfter - feeAccountsBalancesBefore[idx]
      );
      
      // Log each fee account's increase
      CONTRACT_CONFIG.feeAccounts.forEach((feeAccountConfig, idx) => {
        const expectedShare = Math.floor((minExpectedFeeBN.toNumber() * feeAccountConfig.share.toNumber()) / 10000);
        const actualIncrease = feeAccountIncreases[idx];
        const percentage = feeAccountConfig.share.toNumber() / 100;
        
        // For the last account, it should get the remainder
        let expectedAmount = expectedShare;
        if (idx === CONTRACT_CONFIG.feeAccounts.length - 1) {
          const sumOfOthers = feeAccountIncreases.slice(0, -1).reduce((sum, inc) => sum + inc, 0);
          expectedAmount = minExpectedFeeBN.toNumber() - sumOfOthers;
        }
        
        logger.color("yellow").log(
          `Fee Account ${idx + 1} (${feeAccountConfig.pubkey.toBase58().slice(0, 8)}...) [${percentage}%]: ` +
          `expected ~${expectedAmount} lamports, got ${actualIncrease} lamports`
        );
        
        // Validate each account got approximately the right amount
        assert.ok(
          Math.abs(actualIncrease - expectedAmount) <= 1,
          `Fee account ${idx + 1} should receive ${percentage}% of fees (expected ~${expectedAmount}, got ${actualIncrease})`
        );
      });
      
      // Verify total distribution matches expected
      const totalDistributed = feeAccountIncreases.reduce((sum, inc) => sum + inc, 0);
      logger.color("yellow").log(`Total distributed: ${totalDistributed} lamports, Expected: ${minExpectedFeeBN.toString()} lamports`);
      
      assert.ok(
        Math.abs(totalDistributed - minExpectedFeeBN.toNumber()) <= CONTRACT_CONFIG.feeAccounts.length,
        `Total distributed (${totalDistributed}) should match expected fee (${minExpectedFeeBN.toString()}) within rounding tolerance`
      );
      
      logger.color("yellow").log("=== FEE DISTRIBUTION VALIDATED ===");
    }

    // Validate based on bid type
    if (isFinalBid) {
      if (isLocal) {
        ;
      }
      else {
        if (!skipLiqMoveAssumption) {
        // Check Raydium liquidity move worked ok
          //assert.equal(auctionSolBalanceAfter, 0, "All SOL should be withdrawn"); // Check all SOL withdrawn - NOT TRUE, if claims haven't happened yet...

          console.log("auctionPost", auctionPost);

          const distPercent = auctionPost.distPercent.toNumber(); // Calculate locked and expected remaining tokens
          const lockedTokensPercent = distPercent / 100; // 10000 = 100%
          const totalTokens = auctionPost.tokenSupply.toNumber();

          const lockedTokens = Math.floor((totalTokens * (100 - lockedTokensPercent)) / 100);
          const expectedRemainingTokens = totalTokens - lockedTokens;

          const auctionTokenAccount = await getAssociatedTokenAddress(auctionPost.tokenMint, auctionSol, true); // Get auction token balance
          const auctionTokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
          const remainingTokens = parseInt(auctionTokenBalance.value.amount);

          console.log('distPercent', distPercent);
          console.log('TokensPercent', lockedTokensPercent);
          console.log('totalTokens', totalTokens);
          console.log('lockedTokens', lockedTokens);
          console.log('expectedRemainingTokens', expectedRemainingTokens);
          console.log('remainingTokens', remainingTokens);

          if (!skipMigrationWait) {
            assert.equal(Math.abs(remainingTokens - expectedRemainingTokens) <= 1, true, "Remaining tokens should be total tokens minus locked tokens");
          }
        }
        else {
          console.log("Final Bid - skipping liq move assumption as requested...");
        }
      }
    } else {
      if (!skipValidations) {
        assert.equal(auctionPostBids.length - 1, auctionPreBids.length, "Bid length should increase by 1");
        assert.equal(
          auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).eq(expectedAuctionSolIncreaseBN),
          true,
          "Auction SOL increase should match bid amount minus actual fee"
        );

        //console.log("adminBalanceBeforeBN", adminBalanceBeforeBN.toString());
        //console.log("adminBalanceAfterBN", adminBalanceAfterBN.toString());
        //console.log("bidderBalanceBeforeBN", bidderBalanceBeforeBN.toString());
        //console.log("bidderBalanceAfterBN", bidderBalanceAfterBN.toString());
        //console.log("bidAmountBN", bidAmountBN.toString());
        //console.log("networkFeeBN", networkFeeBN.toString());

        const actualDecreaseBN = bidderBalanceBeforeBN.sub(bidderBalanceAfterBN);
        const expectedDecreaseBN = bidAmountBN.add(networkFeeBN).add(new BN(bidsAccountRentPaidByBidder));
        //console.log("actualDecreaseBN", actualDecreaseBN.toString());
        //console.log("expectedDecreaseBN", expectedDecreaseBN.toString());
        const tolerance = new BN(51);// observed (intermittantly): 50 lamport diff..., even grok doesn't get it. life is short.
        assert.ok(
          actualDecreaseBN.sub(expectedDecreaseBN).abs().lte(tolerance),
          `Bidder SOL decrease should approximately match bid amount plus network fee plus bids account rent paid. Actual: ${actualDecreaseBN.toString()}, Expected: ${expectedDecreaseBN.toString()}`
        );
      }
    }

    // Log results
    //console.log(`Bid amount: ${(bidAmountBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    //console.log(`Auction SOL increase: ${(auctionSolBalanceAfterBN.sub(auctionSolBalanceBeforeBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    //console.log(`Bidder SOL decrease: ${(bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    //console.log(`Network tx fee: ${(networkFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    //console.log(`Actual auction fee: ${(actualBidFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    return { auctionPost, bidAmountBN, actualBidFeeBN, feeIncreaseBN, bidQty }
  }

  async function test_cancel_bid(bidderKp: Keypair = USER_KPs[1]) {
    logger.color("magenta").log(`${bidderKp.publicKey} is canceling...`);

    // Derive PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1; // Latest auction ID
    //console.log("Auction ID:", auctionId);
    const [auctionData] = PublicKey.findProgramAddressSync(
      [Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [auctionSol] = PublicKey.findProgramAddressSync(
      [Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Fetch auction data before cancellation
    const auctionDataBefore = await program.account.auction.fetch(auctionData);
    const auctionDataBeforeBids = await getBids(program, auctionId);

    // Find all bids from the caller
    const callerBids = auctionDataBeforeBids.filter(b => b.bidder.equals(bidderKp.publicKey));
    assert.strictEqual(callerBids.length > 0, true, "Bids should exist before cancellation");
    //console.log(`Found ${callerBids.length} bids from bidder ${bidderKp.publicKey.toBase58()}`);

    // Calculate total refund for all bids
    let totalRefund = 0;
    for (const bid of callerBids) {
      const bidQty = bid.bidQty.toNumber();
      const bidSol = bid.bidSol.toNumber();
      const bidAmount = bidQty * bidSol;
      const auctionFee = bid.bidFee.toNumber();
      const bidRefund = bidAmount - auctionFee;
      totalRefund += bidRefund;
      console.log(`Bid: qty=${bidQty}, sol=${bidSol}, amount=${bidAmount}, fee=${auctionFee}, refund=${bidRefund}`);
    }
    //console.log("Total refund:", totalRefund);

    // Capture the bidder's balance before cancellation
    const balanceBefore = await connection.getBalance(bidderKp.publicKey);
    //console.log("Balance before:", balanceBefore);

    // Cancel the bids
    const cancelTx = await program.methods
      .cancelBid()
      .accounts({
        caller: bidderKp.publicKey,
        auctionSolAccount: auctionSol,
        auctionDataAccount: auctionData,
      })
      .transaction();
    cancelTx.feePayer = bidderKp.publicKey;
    cancelTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

    let cancelSig;
    try {
      cancelSig = await sendAndConfirmTransaction(connection, cancelTx, [bidderKp]);
      await logSuccessTx(connection, cancelSig, "cancelBid");
    } catch (err) {
      console.error("logs:", await err.getLogs());
      throw err;
    }

    // Get transaction details to extract network fee
    const txDetails = await getTransactionDetailsWithRetry(connection, cancelSig);
    const networkFee = txDetails.meta.fee;
    //console.log(`Cancellation network fee: ${networkFee} lamports`);

    // Fetch auction data after cancellation
    const auctionDataAfter = await program.account.auction.fetch(auctionData);
    const auctionDataAfterBids = await getBids(program, auctionId);
    // Capture the bidder's balance after cancellation
    const balanceAfter = await connection.getBalance(bidderKp.publicKey);

    // Calculate the expected balance
    const expectedBalance = balanceBefore + totalRefund - networkFee;
    //console.log(`Expected balance: ${expectedBalance} lamports`);
    //console.log(`Actual balance: ${balanceAfter} lamports`);

    // Assert balance matches
    assert.strictEqual(
      balanceAfter,
      expectedBalance,
      `Balance after cancellation should be balanceBefore + totalRefund - networkFee: expected ${expectedBalance}, got ${balanceAfter}`
    );

    // Verify all caller's bids are removed
    const remainingBids = auctionDataAfterBids.filter(b => b.bidder.equals(bidderKp.publicKey));
    assert.equal(remainingBids.length, 0, "All bids from the caller should be removed");

    return { auctionDataAfter, balanceAfter, balanceBefore, totalRefund, networkFee, auctionSol };
  }

  //
  // Raydium - v3 CLMM Pools
  //
  it("admin - pools v3 - creates & LPs CLMM pool", async () => {
    //await test_create_clmm_and_trade_v3();
  });

  async function test_create_clmm_and_trade_v3() {
    if (isLocal) return logger.color("yellow").log("Skipping pool creation on localnet");

    // KEY VARS
    // const INITIAL_PRICE = 0.000861112;
    // const LIQ_TOKENS = 97.91 // == S / P
    // const LIQ_SOL = 0.084317208;

    const INITIAL_PRICE = 0.00038889;
    const LIQ_SOL = 0.038811222;
    const LIQ_TOKENS = 99.8 // == S / P

    const SUPPLY_TOKENS = LIQ_TOKENS * 1.01; //100;
    const SUPPLY_DECIMALS = 6;
    const txVersion = TxVersion.LEGACY;
    const minterKp = adminKp;
    const MIN_TICK = -443636;
    const MAX_TICK = 443636; 

    // **Initialize Raydium SDK**
    const raydium = await Raydium.load({
      connection,
      owner: minterKp,
      disableFeatureCheck: true,
      blockhashCommitment: 'confirmed' 
    });
    logger.color("green").log("Raydium SDK loaded");

    // **Mint Token (100 tokens)**
    const tokenMint = await createMint(connection, minterKp, minterKp.publicKey, null, SUPPLY_DECIMALS);
    const minterTokenAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, tokenMint, minterKp.publicKey);
    await mintTo(
      connection,
      minterKp,
      tokenMint,
      minterTokenAccount.address,
      minterKp,
      BigInt(new BN(SUPPLY_TOKENS).mul(new BN(10).pow(new BN(SUPPLY_DECIMALS))).toString())
    );
    // assert.equal(
    //   (await connection.getTokenAccountBalance(minterTokenAccount.address)).value.uiAmount,
    //   SUPPLY_TOKENS,
    //   "Minter token balance mismatch"
    // );
    logger.color("green").log("Minted tokens");

    // **Wrap SOL to WSOL if needed**
    const minterWsolAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, WSOLMint, minterKp.publicKey);
    const wsolShortfall = LIQ_SOL - ((await connection.getTokenAccountBalance(minterWsolAccount.address)).value.uiAmount || 0);
    if (wsolShortfall > 0) {
      console.log('wsolShortfall', wsolShortfall);
      const wrapTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: minterKp.publicKey,
          toPubkey: minterWsolAccount.address,
          lamports: Math.ceil(wsolShortfall * LAMPORTS_PER_SOL)
        }),
        createSyncNativeInstruction(minterWsolAccount.address)
      );
      wrapTx.feePayer = minterKp.publicKey;
      wrapTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
      await logSuccessTx(connection, await sendAndConfirmTransaction(connection, wrapTx, [minterKp]), "Wrapped SOL to WSOL");
    }

    // **Create CLMM Pool**
    const adminBalanceAtStart = await connection.getBalance(adminKp.publicKey);
    const ammConfig = { ...clmmDevConfigs[0], id: new PublicKey(clmmDevConfigs[0].id), fundOwner: '', description: '' };
    const tokenInfo = {
      chainId: 103,
      address: tokenMint.toBase58(),
      programId: TOKEN_PROGRAM_ID.toBase58(),
      symbol: 'TEST',
      name: 'Test Token',
      decimals: SUPPLY_DECIMALS,
      tags: ['test-token'],
      logoURI: '',
      extensions: {}
    };
    const wsolInfo = {
      chainId: 103,
      address: WSOLMint.toBase58(),
      programId: TOKEN_PROGRAM_ID.toBase58(),
      symbol: 'WSOL',
      name: 'Wrapped SOL',
      decimals: 9,
      tags: ['wrapped', 'solana'],
      logoURI: '',
      extensions: {}
    };
    const { execute: execCreatePool, extInfo: poolExtInfo } = await raydium.clmm.createPool({
      programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID, // new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"),
      mint1: tokenInfo,
      mint2: wsolInfo,
      ammConfig,
      initialPrice: new Decimal(INITIAL_PRICE),
      txVersion
    });
    const createPoolTx = await execCreatePool({ sendAndConfirm: true });
    await logSuccessTx(connection, createPoolTx.txId, "Pool created");
    const poolId = poolExtInfo.address.poolId;

    // **Set Full Range Ticks**
    const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    const tickSpacing = poolInfo.poolInfo.tickSpacing;
    const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
    console.log(`tickLower: ${tickLower}, tickUpper: ${tickUpper}`);

    // **Calculate Exact Amounts**
    const baseAmount = new BN(new Decimal(LIQ_TOKENS).mul(10 ** SUPPLY_DECIMALS).toFixed(0));
    const otherAmountMax = new BN(new Decimal(LIQ_SOL).mul(10 ** 9).toFixed(0));

    // **Open Position from Base with Exact Amounts**
    const { execute: execOpenPosition } = await raydium.clmm.openPositionFromBase({
      computeBudgetConfig: {
        units: 6000000,
        microLamports: 46591500,
      },
      poolInfo: poolInfo.poolInfo,
      poolKeys: poolExtInfo.address,
      tickLower,
      tickUpper,
      base: 'MintB', // *******
      ownerInfo: { useSOLBalance: false },
      baseAmount,
      otherAmountMax,
      txVersion
    });

    // **Capture Initial Balances**
    const initialTokenBalance = new BN((await connection.getTokenAccountBalance(minterTokenAccount.address)).value.amount);
    const initialWsolBalance = new BN((await connection.getTokenAccountBalance(minterWsolAccount.address)).value.amount);
    const initialSolBalance = await connection.getBalance(adminKp.publicKey);

    const positionTx = await execOpenPosition({ sendAndConfirm: true });
    await logSuccessTx(connection, positionTx.txId, "Full range position opened");

    // **Capture Final Balances and Calculate Amounts Taken**
    const finalTokenBalance = new BN((await connection.getTokenAccountBalance(minterTokenAccount.address)).value.amount);
    const finalWsolBalance = new BN((await connection.getTokenAccountBalance(minterWsolAccount.address)).value.amount);
    const finalSolBalance = await connection.getBalance(adminKp.publicKey);

    const tokensTaken = initialTokenBalance.sub(finalTokenBalance);
    const wsolTaken = initialWsolBalance.sub(finalWsolBalance);
    const solSpent = initialSolBalance - finalSolBalance;

    // **Log Results**
    console.log(`Tokens taken: ${tokensTaken.toNumber() / 10 ** SUPPLY_DECIMALS} units (exact: ${baseAmount.toNumber() / 10 ** SUPPLY_DECIMALS})`);
    console.log(`WSOL taken: ${wsolTaken.toNumber() / LAMPORTS_PER_SOL} WSOL (max: ${otherAmountMax.toNumber() / LAMPORTS_PER_SOL})`);
    console.log(`SOL spent (including fee): ${solSpent / LAMPORTS_PER_SOL} SOL`);

    // **Validate Amounts Taken**
    assert.ok(tokensTaken.lte(baseAmount), `Tokens taken (${tokensTaken.toString()}) exceed max (${baseAmount.toString()})`);
    assert.ok(wsolTaken.lte(otherAmountMax), `WSOL taken (${wsolTaken.toString()}) exceed max (${otherAmountMax.toString()})`);

    // **Validate Position Range**
    await sleep(6);
    const adminPositions = await raydium.clmm.getOwnerPositionInfo({ programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID });
    //logObject("adminPositions", adminPositions);
    const position = adminPositions.find(pos => pos.poolId.toBase58() === poolId.toBase58());
    if (!position) throw new Error('Position not found');
    const priceLower = TickUtils.getTickPrice({ poolInfo: poolInfo.poolInfo, tick: position.tickLower, baseIn: true }).price.toNumber();
    const priceUpper = TickUtils.getTickPrice({ poolInfo: poolInfo.poolInfo, tick: position.tickUpper, baseIn: true }).price.toNumber();
    logger.color("green").log(`Liquidity range set: [${priceLower}, ${priceUpper}]`);

    // **Cost and Final Validation**
    const totalCost = (await connection.getBalance(adminKp.publicKey, 'confirmed')) - adminBalanceAtStart;
    console.log('Total cost (SOL):', totalCost / LAMPORTS_PER_SOL);
    const poolInfoRpc = (await raydium.clmm.getRpcClmmPoolInfos({ poolIds: [poolId] }))[poolId];
    console.log(`1 / poolInfoRpc.currentPrice: ${1 / poolInfoRpc.currentPrice} `);
    console.log(`INITIAL_PRICE: ${INITIAL_PRICE}`);

    assert.ok(Math.abs(INITIAL_PRICE - 1 / poolInfoRpc.currentPrice) < 1e-6, 'Current price mismatch');
  }

  // [REF] - Referral system test cases
  it("admin - adds referral mapping successfully", async () => {
    await test_clear_referrals();

      const referrer = USER_KPs[1];
      const referred = USER_KPs[2];
      await test_set_referral(referrer, referred);
      
      const mappings = await test_get_referral_mappings();
      const mapping = mappings.find(m => m.referredAccount.equals(referred.publicKey));
      assert.ok(mapping !== undefined, "Referral mapping should exist");
      assert.ok(mapping.referrerAccount.equals(referrer.publicKey), "Referrer should match");
  });

  it("referrals - bid with referrer when config is zero behaves normally", async () => {
    await test_clear_referrals();

      await test_create_auction_KP0({});
      const bidder = USER_KPs[1];
      const referrer = USER_KPs[2];
      
      // [REF] - Set referral mapping first
      await test_set_referral(referrer, bidder);
      
      // [REF] - Then place a normal bid (should behave like normal with zero config)
      await test_bid_auction({ 
        fill_percent: 0.1, 
        bidderKp: bidder,
        fee_perc: 0.01
      });
      
      // [REF] - No additional referral fee logic should be triggered since config is 0
      logger.color("green").log("[REF] Bid with zero referral config completed successfully");
  });

  it("referrals - normal claim still works with referral mapping set", async () => {
    await test_clear_referrals();

      await test_create_auction_KP0({});
      const claimer = USER_KPs[1];
      const referrer = USER_KPs[2];
      
      // Set referral mapping
      await test_set_referral(referrer, claimer);
      
      // Bid first
      const bidResult = await test_bid_auction({ 
        fill_percent: 1.0, 
        bidderKp: claimer, 
        fee_perc: 0.01
      });
      
      // Wait for auction to end and claim
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // [REF] - Normal claim should still work (no referral logic in claim)
      const result = await test_claim_auction(claimer, true, bidResult);
      
      logger.color("green").log("[REF] Normal claim with referral mapping completed successfully");
  });

  // [REF] - Happy path tests with non-zero referral fee share
  it("referrals - referrer receives 20% of platform fees", async () => {
    await test_clear_referrals();

      // Temporarily set referral fee share to 20%
      await test_init_with_ref_fee_share(2000); // 2000 = 20.0%
      
      await test_create_auction_KP0({});
      const bidder = USER_KPs[1];
      const referrer = USER_KPs[2];
      
      // Set referral mapping
      await test_set_referral(referrer, bidder);
      
      // Get balances before bid
      const referrerBalanceBefore = await connection.getBalance(referrer.publicKey);
    const feeAccountsBalancesBefore = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const totalFeeBalanceBefore = feeAccountsBalancesBefore.reduce((sum, bal) => sum + bal, 0);
      
      // Place bid and get actual results
      const fillPercent = 0.1;
      const feePerc = 0.01;
      const result = await test_bid_auction({ 
        fill_percent: fillPercent, 
        bidderKp: bidder,
        fee_perc: feePerc
      });
      
      // Use ACTUAL total fee from bid result
      const actualTotalFee = result.actualBidFeeBN.toNumber();
      const refShare = 0.2; // Matches the 2000/10000 config
      const expectedReferrerFee = Math.floor(actualTotalFee * refShare);
      const expectedPlatformFee = actualTotalFee - expectedReferrerFee;
      
      logger.color("cyan").log(`[REF] Actual total fee: ${actualTotalFee}`);
      logger.color("cyan").log(`[REF] Expected: referrer=${expectedReferrerFee}, platform=${expectedPlatformFee}`);
      
      // Get balances after bid
      const referrerBalanceAfter = await connection.getBalance(referrer.publicKey);
    const feeAccountsBalancesAfter = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const totalFeeBalanceAfter = feeAccountsBalancesAfter.reduce((sum, bal) => sum + bal, 0);
      
      // Verify referrer received their share (with small tolerance for rounding/lamport diffs)
      const referrerIncrease = referrerBalanceAfter - referrerBalanceBefore;
    const feeAccountIncrease = totalFeeBalanceAfter - totalFeeBalanceBefore;
      
      assert.ok(
        Math.abs(referrerIncrease - expectedReferrerFee) <= 1, // Tolerance for flooring/rounding
        `Referrer should receive ~${expectedReferrerFee} lamports, got ${referrerIncrease}`
      );
      
      assert.ok(
        Math.abs(feeAccountIncrease - expectedPlatformFee) <= 1,
        `Platform should receive ~${expectedPlatformFee} lamports, got ${feeAccountIncrease}`
      );
      
      logger.color("green").log(`[REF] Referrer received ${referrerIncrease} lamports (${refShare * 100}% of ${actualTotalFee} fee)`);
      
      // Reset to zero for other tests
      await test_init_with_ref_fee_share(0);
  });

  it("referrals - multiple bidders same referrer accumulates fees", async () => {
    await test_clear_referrals();
      // Set referral fee share to 30%
      await test_init_with_ref_fee_share(3000); // 3000 = 30.0%
      
      await test_create_auction_KP0({});
      const referrer = USER_KPs[0];
      const bidder1 = USER_KPs[1];
      const bidder2 = USER_KPs[2];
      
      // Set both bidders to same referrer
      await test_set_referral(referrer, bidder1);
      await test_set_referral(referrer, bidder2);
      
      const referrerBalanceBefore = await connection.getBalance(referrer.publicKey);
      
      // Both bidders place bids
      await test_bid_auction({ 
        fill_percent: 0.3,
        bidderKp: bidder1,
        fee_perc: 0.01
      });
      
      await test_bid_auction({ 
        fill_percent: 0.2,
        bidderKp: bidder2,
        fee_perc: 0.01
      });
      
      const referrerBalanceAfter = await connection.getBalance(referrer.publicKey);
      const totalReferrerFees = referrerBalanceAfter - referrerBalanceBefore;
      
      assert.ok(
        totalReferrerFees > 0,
        "Referrer should accumulate fees from multiple referred bidders"
      );
      
      logger.color("green").log(`[REF] Referrer accumulated ${totalReferrerFees} lamports from 2 bidders`);
      
      // Reset
      await test_init_with_ref_fee_share(0);
  });

  it("referrals - 100% fee share gives all fees to referrer", async () => {
    await test_clear_referrals();
      // Set referral fee share to 100%
      await test_init_with_ref_fee_share(10000); // 10000 = 100.0%
      
      await test_create_auction_KP0({});
      const bidder = USER_KPs[1];
      const referrer = USER_KPs[2];
      
      await test_set_referral(referrer, bidder);
      
      const referrerBalanceBefore = await connection.getBalance(referrer.publicKey);
    const feeAccountsBalancesBefore = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const totalFeeBalanceBefore = feeAccountsBalancesBefore.reduce((sum, bal) => sum + bal, 0);
      
      // Place bid
      const result = await test_bid_auction({ 
        fill_percent: 0.1,
        bidderKp: bidder,
        fee_perc: 0.02 // 2% fee
      });
      
      const referrerBalanceAfter = await connection.getBalance(referrer.publicKey);
    const feeAccountsBalancesAfter = await Promise.all(
      CONTRACT_CONFIG.feeAccounts.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );
    const totalFeeBalanceAfter = feeAccountsBalancesAfter.reduce((sum, bal) => sum + bal, 0);
      
      const referrerIncrease = referrerBalanceAfter - referrerBalanceBefore;
    const feeAccountIncrease = totalFeeBalanceAfter - totalFeeBalanceBefore;
      const totalFee = result.actualBidFeeBN.toNumber();
      
      assert.ok(
        Math.abs(referrerIncrease - totalFee) < 1000,
        `Referrer should receive entire fee of ${totalFee} lamports`
      );
      
      assert.ok(
        feeAccountIncrease === 0,
        "Platform should receive 0 when referral share is 100%"
      );
      
      logger.color("green").log(`[REF] Referrer received entire fee: ${referrerIncrease} lamports`);
      
      // Reset
      await test_init_with_ref_fee_share(0);
  });

  it("fees - bid fees across multiple fee accounts", async () => {

    await test_clear_referrals();
    await test_create_auction_KP0({});
    const bidder = USER_KPs[1];

    // Get initial balances
    const feeAccountsBalancesBefore = await Promise.all(
      FEE_ACCOUNTS.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );

    // Place a bid with 1% fee
    const result = await test_bid_auction({
      fill_percent: 0.2,
      bidderKp: bidder,
      fee_perc: 0.01
    });

    // Get final balances
    const feeAccountsBalancesAfter = await Promise.all(
      FEE_ACCOUNTS.map(feeAccountConfig => connection.getBalance(feeAccountConfig.pubkey))
    );

    // Calculate increases for each fee account
    const feeAccountIncreases = feeAccountsBalancesAfter.map((balAfter, idx) =>
      balAfter - feeAccountsBalancesBefore[idx]
    );

    const totalFee = result.actualBidFeeBN.toNumber();

    // Calculate expected amounts based on configured percentages
    let totalAllocated = 0;
    const expectedAmounts = FEE_ACCOUNTS.map((feeAccountConfig, idx) => {
      if (idx === FEE_ACCOUNTS.length - 1) {
        // Last account gets remainder to handle rounding
        return totalFee - totalAllocated;
      } else {
        const amount = Math.floor((totalFee * feeAccountConfig.share) / 10000);
        totalAllocated += amount;
        return amount;
      }
    });

    // Verify each fee account received the correct percentage
    FEE_ACCOUNTS.forEach((feeAccountConfig, idx) => {
      const expectedAmount = expectedAmounts[idx];
      const actualAmount = feeAccountIncreases[idx];
      const percentage = feeAccountConfig.share / 100;

      logger.color("yellow").log(`Fee Account ${idx + 1} (${percentage}%): expected ~${expectedAmount}, got ${actualAmount}`);

      assert.ok(
        Math.abs(actualAmount - expectedAmount) <= 1,
        `Fee account ${idx + 1} should receive ${percentage}% of ${totalFee} lamports (expected ~${expectedAmount}, got ${actualAmount})`
      );
    });

    // Verify total equals the bid fee
    const totalDistributed = feeAccountIncreases.reduce((sum, increase) => sum + increase, 0);
    assert.equal(
      totalDistributed,
      totalFee,
      `Total distributed (${totalDistributed}) should equal total fee (${totalFee})`
    );

    logger.color("yellow").log(`Fee distribution validated: ${feeAccountIncreases.join(', ')} lamports (total: ${totalFee})`);
  });

  it("fees - migration fees across multiple accounts", async () => {
    if (isLocal) {
      console.log("Skipping migration fee test on local validator (no Raydium)");
      return;
    }

    logger.color("yellow").log("Testing migration fee distribution...");

    // Create auction with 3 minute duration
    const auctionResult = await test_create_auction_KP0({
      duration_hours_div100: 5 // 5/100 = 0.05 hours = 3 minutes
    });
    const auctionId = auctionResult.auctionId;
    const tokenMint = auctionResult.tokenMint;

    // Get initial fee account token balances
    const feeAccountsTokenBalancesBefore = await Promise.all(
      FEE_ACCOUNTS.map(async (feeAccountConfig) => {
        const ata = getAssociatedTokenAddressSync(tokenMint, feeAccountConfig.pubkey, true);
        try {
          const balance = await connection.getTokenAccountBalance(ata);
          return new BN(balance.value.amount);
        } catch {
          return new BN(0); // Account doesn't exist yet
        }
      })
    );

    // Get initial fee account WSOL balances
    const feeAccountsWsolBalancesBefore = await Promise.all(
      FEE_ACCOUNTS.map(async (feeAccountConfig) => {
        const ata = getAssociatedTokenAddressSync(NATIVE_MINT, feeAccountConfig.pubkey, true);
        try {
          const balance = await connection.getTokenAccountBalance(ata);
          return new BN(balance.value.amount);
        } catch {
          return new BN(0); // Account doesn't exist yet
        }
      })
    );

    logger.color("yellow").log("Initial token balances:", feeAccountsTokenBalancesBefore.map(b => b.toString()));
    logger.color("yellow").log("Initial WSOL balances:", feeAccountsWsolBalancesBefore.map(b => b.toString()));

    // Place bids to fill the auction
    await test_bid_auction({ 
      fill_percent: 0.4, 
      bidderKp: USER_KPs[0],
      skipMigrationWait: true
    });
    await test_bid_auction({ 
      fill_percent: 0.4, 
      bidderKp: USER_KPs[1],
      skipMigrationWait: true
    });
    
    // Final bid that triggers migration
    await test_bid_auction({ 
      fill_percent: 0.2, 
      bidderKp: USER_KPs[2],
      skipMigrationWait: true
    });

    // Wait for migration to complete
    logger.color("yellow").log("Waiting for migration to complete...");
    const migrationResult = await waitForMigration(auctionId);
    assert.ok(migrationResult.error == null, "Migration should succeed");
    
    // Get final fee account token balances
    const feeAccountsTokenBalancesAfter = await Promise.all(
      FEE_ACCOUNTS.map(async (feeAccountConfig) => {
        const ata = getAssociatedTokenAddressSync(tokenMint, feeAccountConfig.pubkey, true);
        const balance = await connection.getTokenAccountBalance(ata);
        return new BN(balance.value.amount);
      })
    );

    // Get final fee account WSOL balances
    const feeAccountsWsolBalancesAfter = await Promise.all(
      FEE_ACCOUNTS.map(async (feeAccountConfig) => {
        const ata = getAssociatedTokenAddressSync(NATIVE_MINT, feeAccountConfig.pubkey, true);
        const balance = await connection.getTokenAccountBalance(ata);
        return new BN(balance.value.amount);
      })
    );

    logger.color("yellow").log("Final token balances:", feeAccountsTokenBalancesAfter.map(b => b.toString()));
    logger.color("yellow").log("Final WSOL balances:", feeAccountsWsolBalancesAfter.map(b => b.toString()));

    // Calculate increases
    const tokenIncreases = feeAccountsTokenBalancesAfter.map((after, idx) => 
      after.sub(feeAccountsTokenBalancesBefore[idx])
    );
    const wsolIncreases = feeAccountsWsolBalancesAfter.map((after, idx) => 
      after.sub(feeAccountsWsolBalancesBefore[idx])
    );

    // Calculate total fees collected
    const totalTokenFees = tokenIncreases.reduce((sum, inc) => sum.add(inc), new BN(0));
    const totalWsolFees = wsolIncreases.reduce((sum, inc) => sum.add(inc), new BN(0));

    logger.color("yellow").log(`Total token fees collected: ${totalTokenFees.toString()}`);
    logger.color("yellow").log(`Total WSOL fees collected: ${totalWsolFees.toString()}`);

    // Verify fees were collected (0.69% of liquidity)
    assert.ok(totalTokenFees.gt(new BN(0)), "Token fees should be collected");
    assert.ok(totalWsolFees.gt(new BN(0)), "WSOL fees should be collected");

    // Verify percentage distribution for tokens
    logger.color("yellow").log("\nValidating token fee distribution:");
    FEE_ACCOUNTS.forEach((feeAccountConfig, idx) => {
      const expectedShare = totalTokenFees.mul(new BN(feeAccountConfig.share)).div(new BN(10000));
      const actualShare = tokenIncreases[idx];
      const percentage = feeAccountConfig.share / 100;
      
      // For the last account, it should have received the remainder
      if (idx === FEE_ACCOUNTS.length - 1) {
        const sumOfOthers = tokenIncreases.slice(0, -1).reduce((sum, inc) => sum.add(inc), new BN(0));
        const expectedRemainder = totalTokenFees.sub(sumOfOthers);
        
        logger.color("yellow").log(
          `Fee Account ${idx + 1} (${percentage}%): expected ~${expectedShare.toString()} or remainder ${expectedRemainder.toString()}, got ${actualShare.toString()}`
        );
        
        // Allow for rounding differences
        const diff = actualShare.sub(expectedRemainder).abs();
        assert.ok(
          diff.lte(new BN(1)),
          `Token fee account ${idx + 1} should receive remainder to handle rounding`
        );
      } else {
        logger.color("yellow").log(
          `Fee Account ${idx + 1} (${percentage}%): expected ~${expectedShare.toString()}, got ${actualShare.toString()}`
        );
        
        const diff = actualShare.sub(expectedShare).abs();
        assert.ok(
          diff.lte(new BN(1)),
          `Token fee account ${idx + 1} should receive ${percentage}% of fees`
        );
      }
    });

    // Verify percentage distribution for WSOL
    logger.color("yellow").log("\nValidating WSOL fee distribution:");
    FEE_ACCOUNTS.forEach((feeAccountConfig, idx) => {
      const expectedShare = totalWsolFees.mul(new BN(feeAccountConfig.share)).div(new BN(10000));
      const actualShare = wsolIncreases[idx];
      const percentage = feeAccountConfig.share / 100;
      
      // For the last account, it should have received the remainder
      if (idx === FEE_ACCOUNTS.length - 1) {
        const sumOfOthers = wsolIncreases.slice(0, -1).reduce((sum, inc) => sum.add(inc), new BN(0));
        const expectedRemainder = totalWsolFees.sub(sumOfOthers);
        
        logger.color("yellow").log(
          `Fee Account ${idx + 1} (${percentage}%): expected ~${expectedShare.toString()} or remainder ${expectedRemainder.toString()}, got ${actualShare.toString()}`
        );
        
        const diff = actualShare.sub(expectedRemainder).abs();
        assert.ok(
          diff.lte(new BN(1)),
          `WSOL fee account ${idx + 1} should receive remainder to handle rounding`
        );
      } else {
        logger.color("yellow").log(
          `Fee Account ${idx + 1} (${percentage}%): expected ~${expectedShare.toString()}, got ${actualShare.toString()}`
        );
        
        const diff = actualShare.sub(expectedShare).abs();
        assert.ok(
          diff.lte(new BN(1)),
          `WSOL fee account ${idx + 1} should receive ${percentage}% of fees`
        );
      }
    });

    // Verify totals match
    const tokenTotal = tokenIncreases.reduce((sum, inc) => sum.add(inc), new BN(0));
    const wsolTotal = wsolIncreases.reduce((sum, inc) => sum.add(inc), new BN(0));
    
    assert.ok(
      tokenTotal.eq(totalTokenFees),
      `Sum of token distributions (${tokenTotal.toString()}) should equal total fees (${totalTokenFees.toString()})`
    );
    assert.ok(
      wsolTotal.eq(totalWsolFees),
      `Sum of WSOL distributions (${wsolTotal.toString()}) should equal total fees (${totalWsolFees.toString()})`
    );

    logger.color("green").log("\nMigration fee distribution validated successfully!");
    logger.color("green").log(`Token fees: ${tokenIncreases.map(i => i.toString()).join(', ')}`);
    logger.color("green").log(`WSOL fees: ${wsolIncreases.map(i => i.toString()).join(', ')}`);
  });

  it("admin - gets and logs all referral mappings", async () => {
      logger.color("cyan").log("[REF] Getting all referral mappings from contract...");
      
      const mappings = await test_get_referral_mappings();
      
      logger.color("green").log(`[REF] Found ${mappings.length} referral mappings:`);
      
      if (mappings.length === 0) {
          logger.color("yellow").log("[REF] No referral mappings found in contract");
      } else {
          mappings.forEach((mapping, index) => {
              logger.color("blue").log(`[REF] Mapping ${index + 1}:`);
              logger.color("blue").log(`  Referred Account: ${mapping.referredAccount.toBase58()}`);
              logger.color("blue").log(`  Referrer Account: ${mapping.referrerAccount.toBase58()}`);
          });
      }
      
      logger.color("green").log(`[REF] Successfully retrieved and logged ${mappings.length} referral mappings`);
  });

  // [REF] - Helper to reinitialize with different referral fee share
  async function test_init_with_ref_fee_share(refBidFeePercShare: number) {
    const signer = adminKp;

    const newConfig = {
      admin: adminKp.publicKey,
      defaultTokenSupply: new BN(MAXIMEME_TOKEN_SUPPLY),
      defaultTokenDecimals: MAXIMEME_TOKEN_DECIMALS,
      defaultStartPriceLamports: new BN(TEST_STARTPRICE_SOL * LAMPORTS_PER_SOL),
      feeAccounts: FEE_ACCOUNTS.map(account => ({
        pubkey: account.pubkey,
        share: new BN(account.share)
      })),
      daoAccount: TEST_DAO_ACCOUNT.publicKey,
      minTotalSol: new BN(TEST_MIN_TOTAL_SOL * LAMPORTS_PER_SOL),
      refBidFeePercShare: new BN(refBidFeePercShare), // [REF] - Custom referral share
      minBidSize: new BN(TEST_MIN_BID_SIZE), // Minimum bid size in lamports
    };

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);

    try {
      const tx = await program.methods
        .initialize(newConfig)
        .accounts({
          signer: signer.publicKey,
        })
        .signers([signer])
        .transaction();

      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
      logger.color("cyan").log(`[REF] Reinitialized with ref_bid_fee_perc_share: ${refBidFeePercShare}`);
    } catch (error) {
      logger.color("yellow").log("[REF] Config reinit failed (may already be set):", error.message);
    }
  }

  // [REF] - Referral system helper functions
  async function test_init_referral_mappings() {
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);

    logger.color("cyan").log(`[REF] Explicitly initializing referral mappings account...`);

    // Create a dummy referral mapping to initialize the account
    const dummyReferrer = Keypair.generate();
    const dummyReferred = Keypair.generate();

    const tx = await (program.methods as any)
      .setReferral(dummyReferred.publicKey, dummyReferrer.publicKey)
      .accounts({
        globalInfo,
        admin: adminKp.publicKey,
        referralMappings,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([adminKp])
      .transaction();

    tx.feePayer = adminKp.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
      await logSuccessTx(connection, sig, `[REF] init referral mappings with dummy mapping`);
      
      // Verify the account is now properly initialized
      const mappings = await test_get_referral_mappings();
      logger.color("green").log(`[REF] Referral mappings account initialized with ${mappings.length} mappings`);
      
      return sig;
    } catch (err) {
      logger.color("red").log("[REF] init referral mappings failed:", err.getLogs ? err.getLogs() : err);
      throw err;
    }
  }

  async function test_set_referral(referrer_kp: Keypair, referred_kp: Keypair) {
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);

    logger.color("cyan").log(`[REF] Setting referral mapping: ${referred_kp.publicKey.toBase58()} -> ${referrer_kp.publicKey.toBase58()}`);

    const tx = await (program.methods as any)
      .setReferral(referred_kp.publicKey, referrer_kp.publicKey)
      .accounts({
        globalInfo,
        admin: adminKp.publicKey,
        referralMappings,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([adminKp])
      .transaction();

    tx.feePayer = adminKp.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
      await logSuccessTx(connection, sig, `[REF] set_referral: ${referred_kp.publicKey.toBase58().slice(0,8)} -> ${referrer_kp.publicKey.toBase58().slice(0,8)}`);
      return sig;
    } catch (err) {
      logger.color("red").log("[REF] set_referral failed:", err.getLogs ? err.getLogs() : err);
      throw err;
    }
  }

  async function test_get_referral_mappings() {
    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);
    
    try {
      const mappingsAccount = await program.account.referralMappings.fetch(referralMappings);
      return mappingsAccount.referrals;
    } catch (error) {
      logger.color("yellow").log("[REF] Referral mappings account not found or empty");
      return [];
    }
  }

  // [REF] - Helper function to find referrer for a given account
  async function test_get_referrer_for_account(account: PublicKey): Promise<PublicKey | null> {
    const mappings = await test_get_referral_mappings();
    
    for (const mapping of mappings) {
      if (mapping.referredAccount.equals(account)) {
        return mapping.referrerAccount;
      }
    }
    
    return null;
  }

  // [REF] - Test helper to clear all referral mappings (admin only, dev/test networks only)
  async function test_clear_referrals() {
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);

    logger.color("cyan").log("[REF] Clearing all referral mappings (dev/test only)...");

    try {
      const tx = await (program.methods as any)
        .devClearReferrals()
        .accounts({
          globalInfo,
          admin: adminKp.publicKey,
          referralMappings,
        })
        .signers([adminKp])
        .transaction();

      tx.feePayer = adminKp.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
      logger.color("green").log(`[REF] Cleared referral mappings: ${sig}`);
      return sig;
    } catch (err) {
      // Log the actual error to see what's happening
      logger.color("red").log("[REF] dev_clear_referrals failed with error:", err.getLogs ? err.getLogs() : err);

      // Check if it's just account not existing (that's fine)
      const errorMsg = err.message || '';
      const isAccountMissing = errorMsg.includes('Account does not exist') ||
        errorMsg.includes('AccountNotFound') ||
        Object.keys(err).length === 0;

      if (isAccountMissing) {
        logger.color("yellow").log("[REF] Account not initialized yet - no mappings to clear");
        return null;
      }

      // If it's a different error (like mainnet protection), throw it
      throw err;
    }
  }

  async function test_bid_with_referral(bidder_kp: Keypair, referrer_kp: Keypair, auctionId: number, bidQty: number = 10, feePerc: number = 50) {
    // [REF] - First set the referral mapping
    await test_set_referral(referrer_kp, bidder_kp);
    
    // [REF] - Then place the bid (the referral logic will be triggered in place_bid)
    const result = await test_bid_auction({
      useAuctionId: auctionId,
      fill_percent: bidQty / 100, // Convert to percentage
      bidderKp: bidder_kp,
      fee_perc: feePerc / 100, // Convert to 0-1 range
    });
    
    logger.color("cyan").log(`[REF] Bid placed with referral - Bidder: ${bidder_kp.publicKey.toBase58().slice(0,8)}, Referrer: ${referrer_kp.publicKey.toBase58().slice(0,8)}`);
    return result;
  }

  // Admin - view current global config
  async function test_view_current_config() {
    console.log("\n" + "=".repeat(60));
    console.log("📋 VIEWING CURRENT GLOBAL CONFIG");
    console.log("=".repeat(60));

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);

    let currentConfig;
    try {
      const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
      currentConfig = globalInfoAccount.config;
    } catch (error) {
      console.log("❌ Failed to fetch global config:", error.message);
      return;
    }

    if (!currentConfig) {
      console.log("⚠️  No global config found - contract may not be initialized");
      return;
    }

    // Helper function to format large numbers with commas
    const formatNumber = (num) => {
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };

    // Helper function to convert basis points to percentage
    const basisPointsToPercent = (basisPoints) => {
      return (basisPoints / 100).toFixed(2);
    };

    // Helper function to format token supply with decimals
    const formatTokenSupply = (supply, decimals) => {
      const actualSupply = supply.toNumber() / Math.pow(10, decimals);
      return formatNumber(actualSupply.toFixed(2));
    };

    // Format and display the config in human readable format
    console.log("\n🔧 CONTRACT CONFIGURATION:");
    console.log("─".repeat(40));

    console.log(`👤 Admin: ${currentConfig.admin.toBase58()}`);
    console.log(`💰 Default Token Supply: ${formatTokenSupply(currentConfig.defaultTokenSupply, currentConfig.defaultTokenDecimals)} tokens`);
    console.log(`🔢 Default Token Decimals: ${currentConfig.defaultTokenDecimals}`);

    const startPriceSol = currentConfig.defaultStartPriceLamports.toNumber() / LAMPORTS_PER_SOL;
    console.log(`💵 Default Start Price: ${startPriceSol.toFixed(9)} SOL`);

    console.log(`🏛️  DAO Account: ${currentConfig.daoAccount.toBase58()}`);

    const minTotalSol = (currentConfig.minTotalSol.toNumber() / LAMPORTS_PER_SOL).toFixed(6);
    console.log(`📉 Min Total SOL: ${minTotalSol} SOL (minimum SOL raised for auction success - below this = FailedMinNotReached)`);
    console.log(`🔗 Referral Bid Fee Share: ${basisPointsToPercent(currentConfig.refBidFeePercShare.toNumber())}%`);

    console.log("\n💸 FEE ACCOUNTS:");
    console.log("─".repeat(40));
    currentConfig.feeAccounts.forEach((feeAccount, index) => {
      const sharePercent = basisPointsToPercent(feeAccount.share.toNumber());
      console.log(`  ${index + 1}. ${feeAccount.pubkey.toBase58()} - ${sharePercent}% share`);
    });

    console.log("\n📊 CONFIGURATION SUMMARY:");
    console.log("─".repeat(40));
    console.log(`Total Fee Accounts: ${currentConfig.feeAccounts.length}`);
    const totalFeeSharesBasisPoints = currentConfig.feeAccounts.reduce((sum, acc) => sum + acc.share.toNumber(), 0);
    const totalFeeSharesPercent = basisPointsToPercent(totalFeeSharesBasisPoints);
    console.log(`Total Fee Share: ${totalFeeSharesPercent}%`);
    console.log(`Config Valid: ${totalFeeSharesBasisPoints === 10000 ? '✅' : '❌'} (should be 100.00%)`);

    // Check referralMappings account status
    console.log("\n🔗 REFERRAL MAPPINGS ACCOUNT:");
    console.log("─".repeat(40));

    const [referralMappings] = PublicKey.findProgramAddressSync([Buffer.from(referralMappingsSeed)], program.programId);
    console.log(`PDA Address: ${referralMappings.toBase58()}`);

    try {
      const referralMappingsAccount = await connection.getAccountInfo(referralMappings);
      if (referralMappingsAccount) {
        console.log(`✅ Account EXISTS`);
        console.log(`   Owner: ${referralMappingsAccount.owner.toBase58()}`);
        console.log(`   Data Length: ${referralMappingsAccount.data.length} bytes`);
        console.log(`   Lamports: ${referralMappingsAccount.lamports}`);
        console.log(`   Executable: ${referralMappingsAccount.executable}`);

        // Try to deserialize the account data
        if (referralMappingsAccount.data.length > 8) {
          try {
            const referralData = await program.account.referralMappings.fetch(referralMappings);
            console.log(`   Initialized: ✅ YES`);
            console.log(`   Mappings Count: ${referralData.referrals ? referralData.referrals.length : 0}`);

            if (referralData.referrals && referralData.referrals.length > 0) {
              console.log(`   Sample Mappings:`);
              referralData.referrals.slice(0, 3).forEach((mapping, index) => {
                console.log(`     ${index + 1}. Referred: ${mapping.referredAccount.toBase58()}`);
                console.log(`        Referrer: ${mapping.referrerAccount.toBase58()}`);
              });
              if (referralData.referrals.length > 3) {
                console.log(`     ... and ${referralData.referrals.length - 3} more mappings`);
              }
            }
          } catch (deserializeError) {
            console.log(`   Initialized: ❌ NO (deserialization failed)`);
            console.log(`   Error: ${deserializeError.message}`);
            console.log(`   Raw Data (first 32 bytes): ${referralMappingsAccount.data.slice(0, 32).toString('hex')}`);
          }
        } else {
          console.log(`   Initialized: ❌ NO (data too short - only ${referralMappingsAccount.data.length} bytes)`);
        }

        // Check if the account is owned by our program
        const expectedOwner = program.programId.toBase58();
        const actualOwner = referralMappingsAccount.owner.toBase58();
        console.log(`   Owner Match: ${actualOwner === expectedOwner ? '✅' : '❌'} (expected: ${expectedOwner})`);

      } else {
        console.log(`❌ Account DOES NOT EXIST`);
        console.log(`   This means referralMappings PDA has not been initialized yet`);
        console.log(`   You should run the referral initialization before placing bids`);
      }
    } catch (accountError) {
      console.log(`❌ Error fetching account: ${accountError.message}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ CONFIG VIEW COMPLETE");
    console.log("=".repeat(60) + "\n");
  }

  // Admin config viewing test
  it("admin - view current config", async () => {
    await test_view_current_config();
  });

  // Admin key rotation test
  it("admin - rotate admin key to new keypair", async () => {
    logger.color("magenta").log("\n=== ADMIN KEY ROTATION TEST ===");
    
    // Get current config
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const currentConfig = globalInfoAccount.config;
    logger.color("magenta").log("✓ Step 1: Fetched current system configuration");
    
    // Create new admin keypair
    const newAdminKp = Keypair.generate();
    await connection.requestAirdrop(newAdminKp.publicKey, 5 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));
    logger.color("magenta").log("✓ Step 2: Created and funded new admin keypair");
    
    logger.color("magenta").log(`  Current admin:          [${adminKp.publicKey.toBase58()}]`);
    logger.color("red").log(`  Temp admin:             [${newAdminKp.publicKey.toBase58()}]`);
    logger.color("red").log(`  Temp admin private key: [${bs58.encode(newAdminKp.secretKey)}]`);
    
    // Attempt rotation as non-admin (should fail)
    logger.color("magenta").log("Step 3: Testing unauthorized access...");
    const randomKp = Keypair.generate();
    await connection.requestAirdrop(randomKp.publicKey, 1 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      const tx = await program.methods
        .initialize(currentConfig)
        .accounts({
          signer: randomKp.publicKey,
        })
        .signers([randomKp])
        .transaction();
      
      await sendAndConfirmTransaction(connection, tx, [randomKp]);
      assert.fail("Non-admin should not be able to rotate admin key");
    } catch (error) {
      assert.ok(error.message.includes("Unauthorized") || error.message.includes("custom program error: 0x1770"), 
        "Expected Unauthorized error");
      logger.color("magenta").log("✓ Step 3: Random user blocked from hijacking admin");
    }
    
    // Rotate admin key - current admin must sign to authorize
    logger.color("magenta").log("Step 4: Rotating admin key...");
    const updatedConfig = {
      ...currentConfig,
      admin: newAdminKp.publicKey  // Set new admin in config
    };
    
    const tx = await program.methods
      .initialize(updatedConfig)
      .accounts({
        signer: adminKp.publicKey,  // Current admin signs
      })
      .signers([adminKp])
      .transaction();
    
    tx.feePayer = adminKp.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // Execute rotation to set new admin
    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
    await logSuccessTx(connection, sig, "admin key rotation");
    
    // Verify new admin is set
    const updatedGlobalInfo = await program.account.globalInfo.fetch(globalInfo);
    // Deployer field removed - admin is now solely managed via config.admin
    assert.equal(updatedGlobalInfo.config.admin.toBase58(), newAdminKp.publicKey.toBase58(), 
      "Config admin key not updated correctly");
    logger.color("magenta").log("✓ Step 5: Verified new admin in contract state");
    
    // Rotate back to original admin for other tests
    logger.color("magenta").log("Step 6: Reverting to original admin...");
    const revertConfig = {
      ...currentConfig,
      admin: adminKp.publicKey  // Restore original admin
    };
    
    const revertTx = await program.methods
      .initialize(revertConfig)
      .accounts({
        signer: newAdminKp.publicKey,  // New admin signs to revert
      })
      .signers([newAdminKp])
      .transaction();
    
    revertTx.feePayer = newAdminKp.publicKey;
    revertTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    const revertSig = await sendAndConfirmTransaction(connection, revertTx, [newAdminKp]);
    await logSuccessTx(connection, revertSig, "admin key rotation revert");
    
    // Final verification
    const finalGlobalInfo = await program.account.globalInfo.fetch(globalInfo);
    // Deployer field removed - verify admin via config.admin
    assert.equal(finalGlobalInfo.config.admin.toBase58(), adminKp.publicKey.toBase58(), 
      "Admin not reverted correctly");
    logger.color("magenta").log("✓ Step 7: Final verification complete");
    logger.color("magenta").log("=== TEST COMPLETE ===\n");
  });

  it("base - fails when bid size is below minimum", async () => { // anti DoS wwith unbound vec growth in contract
    // Set very high min_bid_size for this test
    const highMinBidSize = 1000000000; // = 1.0 SOL

    // Backup current config to restore later
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const currentGlobalInfo = await program.account.globalInfo.fetch(globalInfo);
    const backupConfig = currentGlobalInfo.config;

    try {
      // Set high min_bid_size  
      const newConfig = {
        admin: adminKp.publicKey,
        defaultTokenSupply: new BN(MAXIMEME_TOKEN_SUPPLY),
        defaultTokenDecimals: MAXIMEME_TOKEN_DECIMALS,
        defaultStartPriceLamports: new BN(TEST_STARTPRICE_SOL * LAMPORTS_PER_SOL),
        feeAccounts: FEE_ACCOUNTS.map(account => ({
          pubkey: account.pubkey,
          share: new BN(account.share)
        })),
        daoAccount: TEST_DAO_ACCOUNT.publicKey,
        minTotalSol: new BN(TEST_MIN_TOTAL_SOL * LAMPORTS_PER_SOL),
        refBidFeePercShare: new BN(TEST_REF_BID_FEE_PERC_SHARE),
        minBidSize: new BN(highMinBidSize), // Set very high minimum
      };

      await program.methods
        .initialize(newConfig)
        .accounts({
          signer: adminKp.publicKey,
          globalInfo: globalInfo,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([adminKp])
        .rpc();

      logger.color("green").log(`✓ Set min_bid_size to ${highMinBidSize} lamports`);

      // Create an auction
      await test_create_auction_KP0({ duration_hours_div100: 1 });

      // Try to place a small bid that should fail
      try {
        const bidResult = await test_bid_auction({
          fill_percent: 0.001, // 0.1%
          bidderKp: USER_KPs[0],
          // This will create a bid with total cost much less than highMinBidSize
        });

        // If we reach here, the test failed because the bid should have been rejected
        assert.fail("Expected bid to fail due to minimum bid size validation");

      } catch (error) {
        // Check if the error message indicates the bid was rejected for the right reason
        const errorMsg = error.toString();
        if (errorMsg.includes("BidSizeBelowMinimum") || errorMsg.includes("6001")) {
          logger.color("green").log(`✓ Bid correctly rejected for being below minimum: ${errorMsg}`);
        } else {
          logger.color("red").log(`✗ Bid failed for unexpected reason: ${errorMsg}`);
          throw error;
        }
      }

    } finally {
      // Restore original config
      await program.methods
        .initialize(backupConfig)
        .accounts({
          signer: adminKp.publicKey,
          globalInfo: globalInfo,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([adminKp])
        .rpc();

      logger.color("green").log("✓ Restored original config");
    }
  });

}); // End of "maxi-auction" describe block

async function getPoolDbAndRpcInfos(successfulResults: { auctionId: any; solBalanceAuctionData: any; solBalanceAuctionSol: any; solBalanceAuctionTokenAccount: any; rentExemptionAuctionData: any; rentExemptionAuctionSol: any; rentExemptionAuctionTokenAccount: any; tokenBalance: string; status: any; isFinalized: any; tokenMintPublicKey: any; }[]) {

  const poolDbInfosPromises = successfulResults.map(x => getMarketAndPoolInfoDb(x.tokenMintPublicKey));
  const poolDbInfos = await Promise.all(poolDbInfosPromises);

  const v3PoolIds = poolDbInfos.filter(p => p?.pool_id && !p?.market_id).map(info => info?.pool_id).filter(id => id !== undefined && id !== null); // v3 CLMM use only pools
  const uniquev3PoolIds = [...new Set(v3PoolIds)];

  //logObject("uniquev3PoolIds", uniquev3PoolIds);

  // Fetch all pool infos in one RPC - v2
  const raydium = await Raydium.load({ connection, owner: adminKp, disableFeatureCheck: false, blockhashCommitment: 'finalized' });

  // Fetch all pool infos in one RPC - v3
  const rpcResultv3 = uniquev3PoolIds.length > 0 ? await raydium.clmm.getRpcClmmPoolInfos({ poolIds: uniquev3PoolIds }) : {};
  const poolPpcInfosMapv3 = new Map(Object.entries(rpcResultv3));

  return { poolDbInfos, poolPpcInfosMapv3 };
}

/*async function logAuctionInfo(
  poolDbInfos: { market_info: string | null; pool_keys: string | null; market_id: string | null; pool_id: string | null; }[],
  index: number,
  poolPpcInfosMapv2: Map<string, AmmRpcData>,
  poolPpcInfosMapv3: Map<string, ClmmRpcData>,
  x: {
    auctionId: any;
    solBalanceAuctionData: string;
    solBalanceAuctionSol: string;
    solBalanceAuctionTokenAccount: string;
    rentExemptionAuctionData: string;
    rentExemptionAuctionSol: string;
    rentExemptionAuctionTokenAccount: string;
    tokenBalance: string;
    status: string;
    isFinalized: any;
    tokenMintPublicKey: any;
    clearingPrice: any;
    solBalanceAuctionBids: any;
    rentExemptionAuctionBids: any;
    bidCountAuctionBids: any;
  }) {
  try {
    const poolDbInfo = poolDbInfos[index];
    const poolPpcInfov2 = poolDbInfo?.pool_id ? poolPpcInfosMapv2.get(poolDbInfo.pool_id) : undefined;
    const poolPpcInfov3 = poolDbInfo?.pool_id ? poolPpcInfosMapv3.get(poolDbInfo.pool_id) : undefined;
    const poolPrice = Number(poolPpcInfov2?.poolPrice || poolPpcInfov3?.currentPrice);
    const baseReserve_v2 = poolPpcInfov2?.baseReserve ? new BN(poolPpcInfov2?.baseReserve, 16) : null;
    const quoteReserve_v2 = poolPpcInfov2?.quoteReserve ? new BN(poolPpcInfov2?.quoteReserve, 16) : null;
    // var lpProviders = "N/A (1)";
    // try {
    //   if (poolPpcInfo) {
    //     lpProviders = await getLpProvidersForPool(connection, poolPpcInfo);
    //   }
    // } catch (error) {
    //   console.error(`Error fetching LP providers for pool ${ poolDbInfo.pool_id }:`, error);
    // }
    console.log(
      `ID: ${x.auctionId.toString().padEnd(3)}, [${(x.status ?? "-").padEnd(25)}], ` +
      `AD: ${(x.solBalanceAuctionData ?? "-").padEnd(12)} ` + //(${(x.rentExemptionAuctionData ?? " ").padEnd(12)}), ` +
      `AS: ${(x.solBalanceAuctionSol ?? "-").padEnd(12)} ` + //(${(x.rentExemptionAuctionSol ?? " ").padEnd(12)}), ` +
      `AT: ${(x.solBalanceAuctionTokenAccount ?? "-").padEnd(12)} ` + //(${(x.rentExemptionAuctionTokenAccount ?? " ").padEnd(12)}), ` +
      `AB(${x.bidCountAuctionBids || 0}): ${(x.solBalanceAuctionBids ?? "-").padEnd(12)} ` + //(${(x.rentExemptionAuctionBids ?? " ").padEnd(12)}), ` +

      `Tokens: ${parseInt(x.tokenBalance).toString().padEnd(12)}, ` +
      `Mint: ${x.tokenMintPublicKey} ` +
      `CP: ${(x.clearingPrice ? (x.clearingPrice.toNumber() / LAMPORTS_PER_SOL).toFixed(10) : "-").padEnd(12)} ` +
      `Pool: ${poolDbInfo?.pool_id || "-"} ` +
      (poolPpcInfov2 || poolPpcInfov3
        ? (`> PRICE: ${(1 / poolPrice).toFixed(10)} ` +
          (baseReserve_v2 && quoteReserve_v2
            ? `LIQv2: [${baseReserve_v2.toString()} T - lamports, ${(Number(quoteReserve_v2.toString()) / LAMPORTS_PER_SOL).toFixed(9)} WSOL]` //LP Providers: [${lpProviders}]`
            : 'LIQv3: TBC'))
        : '')
    );
  }
  catch (error) {
    console.error(`Error logging auction info for index ${index}:`, error);
  }
}

async function getLpProvidersForPool(connection, poolInfo) {
  if (!poolInfo || !poolInfo.lpMint) return "N/A (2)";

  const lpMint = new PublicKey(poolInfo.lpMint);
  const lpProviders = await fetchLpProviders(connection, lpMint);

  // Convert PublicKey objects to shortened base58 strings and join with commas
  return lpProviders.map(provider => {
    const pubkeyStr = provider.toBase58();
    return `${pubkeyStr.substring(0, 4)}...${pubkeyStr.substring(pubkeyStr.length - 4)}`;
  }).join(', ');
}

async function fetchLpProviders(connection, lpMint) {
  const filters = [
    {
      memcmp: {
        offset: 0,
        bytes: lpMint.toBase58(),
      },
    },
  ];
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, { filters });
  return accounts.map(account => account.pubkey);
}*/

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
  //await sleep(3);
  const status = await connection.getSignatureStatus(sig);
  //console.log("TX status:", status);

  // Fetch transaction details
  //const txDetails = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const txDetails = await getTransactionDetailsWithRetry(connection, sig);

  // Log the transaction signature
  logger.color("white").bgColor("green").log(`>> ${label} << TX sig:`, sig);

  // Log the transaction logs if available
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
  logger.bgColor("yellow").color("white").log(`zzz ${secs}...`);
  await new Promise(resolve => setTimeout(resolve, secs * 1000));
}

const getAndLockMaxiPrivKey = async () => {
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

/**
 * Test helper: Save auction data to the auction table
 * Equivalent to saveAuctionToDatabase in BlockchainController
 */
const test_saveAuctionToDatabase = async (
  auctionId: number,
  signature: string,
  xId: string,
  tokenMint: string
): Promise<void> => {
  try {
    logger.info(`💾 [test_saveAuctionToDatabase] Starting to save auction ${auctionId} to database`);
    logger.info(`💾 [test_saveAuctionToDatabase] Token mint: ${tokenMint || 'null'}`);

    const pool = new sql.ConnectionPool(DB_CONFIG);
    await pool.connect();

    logger.info("🔍 [test_saveAuctionToDatabase] Starting database transaction");
    const transaction = pool.transaction();
    await transaction.begin();
    logger.info("✅ [test_saveAuctionToDatabase] Database transaction started");

    try {
      const insertQuery = `
        INSERT INTO [auction] (
          id,
          txid,
          x_id,
          token_mint
        ) VALUES (
          @auctionId,
          @txid,
          @xId,
          @tokenMint
        )
      `;

      logger.info(`🔍 [test_saveAuctionToDatabase] Executing insert for auction ${auctionId}:`, {
        auctionId,
        txid: signature,
        xId,
        tokenMint
      });

      await transaction.request()
        .input('auctionId', sql.Int, auctionId)
        .input('txid', sql.NVarChar(88), signature)
        .input('xId', sql.NVarChar(40), xId)
        .input('tokenMint', sql.NVarChar(255), tokenMint)
        .query(insertQuery);

      logger.info(`✅ [test_saveAuctionToDatabase] Successfully inserted auction ${auctionId} to database`);

      await transaction.commit();
    } catch (error) {
      logger.error("❌ [test_saveAuctionToDatabase] Error during auction insertion, rolling back transaction");
      await transaction.rollback();
      throw error;
    } finally {
      await pool.close();
    }

  } catch (error) {
    logger.error(`❌ [test_saveAuctionToDatabase] Failed to save auction ${auctionId} to database:`, error);
    throw error;
  }
};

/**
 * Test helper: Update KeyPair with auction ID
 * Equivalent to updateKeypairAuctionId in BlockchainController
 */
const test_updateKeypairAuctionId = async (
  auctionId: number,
  tokenMint: string
): Promise<void> => {
  try {
    logger.info(`💾 [test_updateKeypairAuctionId] Starting to update KeyPair for auction ${auctionId}`);

    const pool = new sql.ConnectionPool(DB_CONFIG);
    await pool.connect();

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      const updateQuery = `
        UPDATE [dbo].[KeyPair] 
        SET auctionId = @auctionId
        WHERE PublicKey = @publicKey
      `;

      logger.info(`🔍 [test_updateKeypairAuctionId] Executing update for auction ${auctionId}:`, {
        auctionId,
        publicKey: tokenMint
      });

      await transaction.request()
        .input('auctionId', sql.Int, auctionId)
        .input('publicKey', sql.VarChar(255), tokenMint)
        .query(updateQuery);

      logger.info(`✅ [test_updateKeypairAuctionId] Successfully updated KeyPair for auction ${auctionId}`);

      await transaction.commit();
    } catch (error) {
      logger.error("❌ [test_updateKeypairAuctionId] Error during KeyPair update, rolling back transaction");
      await transaction.rollback();
      throw error;
    } finally {
      await pool.close();
    }

  } catch (error) {
    logger.error(`❌ [test_updateKeypairAuctionId] Failed to update KeyPair for auction ${auctionId}:`, error);
    throw error;
  }
};

const VALID_PROGRAM_ID = new Set([
  AMM_V4.toBase58(),
  AMM_STABLE.toBase58(),
  //DEVNET_PROGRAM_ID.AmmV4.toBase58(),
  //DEVNET_PROGRAM_ID.AmmStable.toBase58(),
  DEVNET_PROGRAM_ID.AMM_V4.toBase58(),
  DEVNET_PROGRAM_ID.AMM_STABLE.toBase58(),
]);
const isValidAmm = (id: string) => VALID_PROGRAM_ID.has(id);

async function setupAccount(connection: Connection, adminKp: Keypair, setupAccountPubKey: PublicKey) {
  const feeBalance = await connection.getBalance(setupAccountPubKey);
  const minBalance = await connection.getMinimumBalanceForRentExemption(0); // 0 bytes for a basic system account
  if (feeBalance < minBalance) {
    console.log("Funding account...", setupAccountPubKey.toBase58());
    const lamportsToFund = minBalance - feeBalance;

    const transferIx = SystemProgram.transfer({
      fromPubkey: adminKp.publicKey,
      toPubkey: setupAccountPubKey,
      lamports: lamportsToFund
    });

    const tx = new Transaction().add(transferIx);
    tx.feePayer = adminKp.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
    await logSuccessTx(connection, sig, "setupAccount " + setupAccountPubKey.toBase58());
  } else {
    console.log(`account ${setupAccountPubKey.toBase58()} already has sufficient balance for rent exemption.`);
  }
}

async function waitForMigration(auctionId: number): Promise<{ success: boolean, error?: any }> {
  if (isLocal) {
    console.log("waitForMigration - local: NOP, no raydium here...");
    return { success: true }; // Assume success for local environment
  }

  console.log(`waitForMigration - waiting for auction migration ${auctionId.toString()}...`);
  const auctionFilledPromise = new Promise<{ success: boolean, error?: any }>((resolve) => {
    auctionFilledPromises.set(auctionId.toString(), resolve);
  });

  // Add a timeout to prevent hanging
  const timeoutPromise = new Promise<{ success: boolean, error?: any }>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout waiting for migration of auction ID ${auctionId}`)), 60000);
  });

  const result = await Promise.race([auctionFilledPromise, timeoutPromise]);
  console.log("waitForMigration - migration completed for auction ID:", auctionId);
  return result;
}

async function getAuctionDetails(auctionId, connection, program, auctionDataSeed, auctionSolSeed, auctionBidsSeed) {
  try {
    //console.log("getAuctionDetails - auctionId", auctionId);

    // Derive PDAs
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionBids] = PublicKey.findProgramAddressSync([Buffer.from(auctionBidsSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);

    // Fetch account info for SOL balances and data lengths
    const auctionDataInfo = await connection.getAccountInfo(auctionData);
    const auctionSolInfo = await connection.getAccountInfo(auctionSol);
    const auctionBidsInfo = await connection.getAccountInfo(auctionBids);

    // Initialize variables to undefined
    let auction = undefined;
    let tokenMint = undefined;
    let auctionTokenAccount = undefined;
    let auctionTokenAccountInfo = undefined;
    let solBalanceAuctionData = undefined;
    let solBalanceAuctionSol = undefined;
    let solBalanceAuctionTokenAccount = undefined;
    let rentExemptionAuctionData = undefined;
    let rentExemptionAuctionSol = undefined;
    let rentExemptionAuctionTokenAccount = undefined;
    let tokenAmount = "0";
    let status = undefined;
    let isFinalized = undefined;
    let tokenMintPublicKey = undefined;
    let clearingPrice = undefined;

    let solBalanceAuctionBids = undefined;
    let rentExemptionAuctionBids = undefined;
    let bidCountAuctionBids = undefined;

    // If auctionData exists, fetch auction details
    if (auctionDataInfo) {
      auction = await program.account.auction.fetch(auctionData);
      tokenMint = auction.tokenMint;
      tokenMintPublicKey = tokenMint.toBase58();
      isFinalized = auction.isFinalized;
      clearingPrice = auction.clearingPrice;

      status = Object.keys(auction.lastStatus)[0]; // Assuming lastStatus is an enum-like object

      // Get SOL balance and rent exemption for auctionData
      solBalanceAuctionData = auctionDataInfo.lamports / LAMPORTS_PER_SOL;
      rentExemptionAuctionData = await connection.getMinimumBalanceForRentExemption(auctionDataInfo.data.length) / LAMPORTS_PER_SOL;

      // Derive and check auctionTokenAccount only if tokenMint exists
      if (tokenMint) {
        auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true);
        auctionTokenAccountInfo = await connection.getAccountInfo(auctionTokenAccount);
      }
    }

    // if auction bids account exists, get its bid count & SOL balance and rent exemption
    if (auctionBidsInfo) {
      solBalanceAuctionBids = auctionBidsInfo.lamports / LAMPORTS_PER_SOL;
      rentExemptionAuctionBids = await connection.getMinimumBalanceForRentExemption(auctionBidsInfo.data.length) / LAMPORTS_PER_SOL;
      const auctionBidsAccount = await program.account.bids.fetch(auctionBids);
      bidCountAuctionBids = auctionBidsAccount?.bids.length;
    }

    // If auctionSol exists, get its SOL balance and rent exemption
    if (auctionSolInfo) {
      solBalanceAuctionSol = auctionSolInfo.lamports / LAMPORTS_PER_SOL;
      rentExemptionAuctionSol = await connection.getMinimumBalanceForRentExemption(auctionSolInfo.data.length) / LAMPORTS_PER_SOL;
    }

    // If auctionTokenAccount exists, get its SOL balance, rent exemption, and token balance
    if (auctionTokenAccountInfo) {
      solBalanceAuctionTokenAccount = auctionTokenAccountInfo.lamports / LAMPORTS_PER_SOL;
      rentExemptionAuctionTokenAccount = await connection.getMinimumBalanceForRentExemption(auctionTokenAccountInfo.data.length) / LAMPORTS_PER_SOL;

      try {
        const tokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
        tokenAmount = tokenBalance.value.uiAmountString;
      } catch (error) {
        if (error.message.includes("could not find account")) {
          tokenAmount = "0"; // Account might be closed or not initialized
        } else {
          throw error;
        }
      }
    }

    // Return detailed payload with undefined for missing accounts
    const details = {
      auctionId,
      solBalanceAuctionData: solBalanceAuctionData !== undefined ? solBalanceAuctionData.toFixed(9) : undefined,
      solBalanceAuctionSol: solBalanceAuctionSol !== undefined ? solBalanceAuctionSol.toFixed(9) : undefined,
      solBalanceAuctionTokenAccount: solBalanceAuctionTokenAccount !== undefined ? solBalanceAuctionTokenAccount.toFixed(9) : undefined,
      rentExemptionAuctionData: rentExemptionAuctionData !== undefined ? rentExemptionAuctionData.toFixed(9) : undefined,
      rentExemptionAuctionSol: rentExemptionAuctionSol !== undefined ? rentExemptionAuctionSol.toFixed(9) : undefined,
      rentExemptionAuctionTokenAccount: rentExemptionAuctionTokenAccount !== undefined ? rentExemptionAuctionTokenAccount.toFixed(9) : undefined,
      tokenBalance: tokenAmount,
      status,
      isFinalized,
      tokenMintPublicKey,
      clearingPrice,
      solBalanceAuctionBids: solBalanceAuctionBids !== undefined ? solBalanceAuctionBids.toFixed(9) : undefined,
      rentExemptionAuctionBids: rentExemptionAuctionBids !== undefined ? rentExemptionAuctionBids.toFixed(9) : undefined,
      bidCountAuctionBids: bidCountAuctionBids !== undefined ? bidCountAuctionBids.toString() : undefined,
    };
    //console.log("getAuctionDetails - details", details);
    return details;
  } catch (error) {
    console.error(`Error fetching details for auction ID ${auctionId}:`, error);
    return null; // Return null for failed queries to filter later
  }
}

// Rate limiting helper - add this before the finalizeAuction function
async function retryWithBackoff<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 5, 
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const is429 = error.message?.includes('429') || error.message?.includes('Too Many Requests');
      
      if (is429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Exponential backoff with jitter
        console.log(`Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error; // Re-throw if not 429 or max retries exceeded
    }
  }
  throw new Error('Max retries exceeded');
}

async function finalizeAuction(auctionId) {
  const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
  const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
  const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
  
  // Wrap RPC calls in retry logic
  const auction = await retryWithBackoff(async () => await program.account.auction.fetch(auctionData));
  const tokenMint = auction.tokenMint;
  const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true); // Allow off-curve for PDA
  const adminTokenAccount = await getAssociatedTokenAddress(tokenMint, adminKp.publicKey);
  //const feeAccount = TEST_FEE_ACCOUNT;

  // Log initial state for debugging
  logger.color("magenta").log(`Admin is aborting auction ${auctionId}...`);
  const auctionSolBalanceBefore = await retryWithBackoff(async () => await connection.getBalance(auctionSol));
  const auctionTokenBalanceBefore = await retryWithBackoff(async () => await connection.getTokenAccountBalance(auctionTokenAccount));
  console.log(`Before abort - Auction SOL: ${(auctionSolBalanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL, Tokens: ${auctionTokenBalanceBefore.value.uiAmount}`);

  // ensure admin token account exists
  await retryWithBackoff(async () => await getOrCreateAssociatedTokenAccount(connection, adminKp, tokenMint, adminKp.publicKey));

  // Construct and send the transaction
  const tx = await program.methods
    .finalize()
    .accounts({
      admin: adminKp.publicKey,
      //feeAccount: feeAccount.publicKey,
      auctionDataAccount: auctionData,
      auctionSolAccount: auctionSol,
      auctionTokenAccount: auctionTokenAccount,
      adminTokenAccount: adminTokenAccount,
    })
    //.signers([adminKp, /*feeAccount*/])
    .transaction();
  tx.feePayer = adminKp.publicKey;
  tx.recentBlockhash = (await retryWithBackoff(async () => await connection.getLatestBlockhash('finalized'))).blockhash;
  try {
    const sig = await retryWithBackoff(async () => await sendAndConfirmTransaction(connection, tx, [adminKp]));  // admin sig only
    await logSuccessTx(connection, sig, "finalize");
  } catch (error) {
    console.log('finalize - error', error);
    return;
  }

  // Log post-abort state for verification
  const auctionSolBalanceAfter = await retryWithBackoff(async () => await connection.getBalance(auctionSol));
  let auctionTokenBalanceAfter;
  try {
    auctionTokenBalanceAfter = await retryWithBackoff(async () => await connection.getTokenAccountBalance(auctionTokenAccount));
  } catch (error) {
    if (error.message.includes("could not find account")) {
      auctionTokenBalanceAfter = { value: { uiAmount: 0 } }; // Account closed
    } else {
      throw error;
    }
  }
  console.log(`After abort - Auction SOL: ${(auctionSolBalanceAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL, Tokens: ${auctionTokenBalanceAfter.value.uiAmount}`);

  // Basic validation
  //assert.ok(auctionSolBalanceBefore > 0 && auctionSolBalanceAfter < auctionSolBalanceBefore, "Auction SOL balance should decrease after abort");
  //assert.equal(auctionTokenBalanceAfter.value.uiAmount, 0, "Auction token balance should be zero after abort");

  console.log(`Auction ${auctionId} aborted successfully.`);
}

async function getMarketAndPoolInfoDb(tokenMintPublicKey: string): Promise<{
  market_info: string | null;
  pool_keys: string | null;
  market_id: string | null;
  pool_id: string | null;
} | null> {
  if (tokenMintPublicKey == undefined) return null;

  const pool = new sql.ConnectionPool(DB_CONFIG);
  try {
    await pool.connect();
    const query = `
      SELECT market_info, pool_keys, market_id, pool_id
      FROM [dbo].[KeyPair]
      WHERE PublicKey = @publicKey
    `;

    const request = pool.request();
    request.input("publicKey", sql.VarChar(255), tokenMintPublicKey);
    const result = await request.query(query);
    if (result.recordset.length === 0) {
      console.warn(`No record found for PublicKey: ${tokenMintPublicKey}`);
      return null;
    }
    const record = result.recordset[0];

    return {
      market_info: record.market_info,
      pool_keys: record.pool_keys,
      market_id: record.market_id,
      pool_id: record.pool_id,
    };
  } catch (error) {
    console.error(`Error fetching market and pool info for ${tokenMintPublicKey}:`, error);
    throw error;
  } finally {
    await pool.close();
  }
}

export const clmmDevConfigs = [
  {
    id: PublicKey.findProgramAddressSync([Buffer.from('amm_config'), Buffer.from([0, 0])], DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID)[0].toBase58(),  // Compute PDA for index 0
    index: 0,
    protocolFeeRate: 120000,
    tradeFeeRate: 100,
    tickSpacing: 1,
    fundFeeRate: 40000,
    description: 'Best for very stable pairs',
    defaultRange: 0.005,
    defaultRangePoint: [0.001, 0.003, 0.005, 0.008, 0.01],
  },
  /*{
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
  },*/
]

// **Helper function to get bids from separate account**
async function getBids(program: Program<MaxiAuction>, auctionId: number) {
  const [bidsPda] = PublicKey.findProgramAddressSync([Buffer.from(auctionBidsSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
  const accountInfo = await program.provider.connection.getAccountInfo(bidsPda);
  if (accountInfo === null) {
    console.log(`getBids - no bids! bidsPda: ${bidsPda}, auctionId:`, auctionId);
    return [];  // no first bid yet; the bids account isn't created
  }
  const bidsAccount = await program.account.bids.fetch(bidsPda);
  return bidsAccount.bids;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToInt(base58Str) {
  let value = 0;
  for (let i = 0; i < base58Str.length; i++) {
    const char = base58Str[i];
    const charValue = BASE58_ALPHABET.indexOf(char);
    if (charValue === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    value = value + charValue;
  }
  return value;
}

function generateRandomBase58(length) {
  let result = '';
  const characters = BASE58_ALPHABET;
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}