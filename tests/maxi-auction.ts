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

  TEST_LOCK_PERCENT,
  TEST_STARTPRICE_SOL,
  TEST_TOKEN_DECIMALS,
  TEST_TOKEN_NAME,
  //TestTokenQty,
  TEST_TOKEN_SUPPLY,
  TEST_TOKEN_SYMBOL,
  TEST_TOKEN_URI,
  TEST_MINTOTAL_SOL,
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

const TEST_FEE_ACCOUNT = Keypair.fromSecretKey(bs58.decode("4hbfT4t6HZtcBVUq983nHXnXs7KdQXxrNUdkCVPaNYT82qSd3hH7eVJkgVicHX9MtatidQuEi3E5nXJ5UbE9ExHp")); // 12MhCcaTUtiG86K5ahiAmYSZ4Z9VCsxUKSTcAQjimaxi
const DEVNET_USER_KEYPAIRS = [
  Keypair.fromSecretKey(bs58.decode("4kbfHLgTTVT23ezNackE3a6m3BCQg3vYmEqZNbHLvZbWs8Dd68FqM7QmbH1w2r7BZHrb6bAjevB1dwpfgz9Psdw8")), // 1246q8oDCgE77wEbJx5XxAPkw51YesEGqUkRGbZ3maxi
  Keypair.fromSecretKey(bs58.decode("2rAK3bLbA2VeR5sFFVYhamZ7Muhz2TgkG7RBAnDVXwvhXmsiZwwL8ohZNiqWCzZcBDgL4PhRvTuKZMxoJSVxWwGW")), // 124N6YAiiKRi8ze2aDBhVo4h5ratuczB321xrU3Cmaxi
  Keypair.fromSecretKey(bs58.decode("oxdUtKkwYAQoyLLJPG84E8PDETbJauWAPJw7oRMvkeDg4FiwfB3e5QWej5XXFYCa1F2wFVzV2EbzNy9zv5qxetA")), // 12EXXrg6sivexwusYGMD42aKc1geB3NJJLENfYjhmaxi
]
var CONTRACT_CONFIG: any;

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

  program.addEventListener("auctionFilled", async (event) => {
    logObject(">>> auctionFilled", event);

    if (isLocal) {
      console.log("auctionFilled event received on local network: NOP, no raydium here...");
    }
    else {
      const signer = adminKp;
      const auctionId = Number(event.auctionId.toString());
      const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const [auctionData] = PublicKey.findProgramAddressSync(
        [Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
      const auctionDataAccount = await program.account.auction.fetch(auctionData);
      //logObject("auctionDataAccount", auctionDataAccount);

      // Process migration and resolve the promise
      await migrateAuction(program, isMainnet, auctionId, adminKp, connection).then(() => {
        const resolve = auctionFilledPromises.get(auctionId);
        if (resolve) {
          resolve(); // Signal that migration is complete
          auctionFilledPromises.delete(auctionId); // Clean up the Map
        }
      }).catch((err) => {
        console.error(`migrateAuction -> error`, err);
        throw err;
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

  for (var i = 0; i < 3; i++) {
    USER_KPs[i] = isLocal
      ? Keypair.generate()
      : DEVNET_USER_KEYPAIRS[i];
  }

  before(async () => {
    // get a maxi keypair from DB
    //tokenKp1 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();
    //tokenKp2 = Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey())); //Keypair.generate();

    if (isLocal) {
      logger.color("blue").log("Airdropping SOL to accounts...");
      logger.color("green").log("Airdrop SOL to admin");

      const airdropAndConfirm = async (account, amount) => {
        try {
          const tx = await connection.requestAirdrop(account.publicKey, amount);
          console.log(`Airdropping ${amount / LAMPORTS_PER_SOL} SOL to ${account.publicKey.toBase58()}`);
          await connection.confirmTransaction(tx);
          console.log(`Confirmed airdrop for ${account.publicKey.toBase58()}`);
        } catch (err) {
          console.error(`Airdrop or confirmation failed for ${account.publicKey.toBase58()}:`, err);
        }
      };
      const airdropPromises = USER_KPs.map(account =>
        airdropAndConfirm(account, 1 * LAMPORTS_PER_SOL)
      );
      airdropPromises.push(airdropAndConfirm(adminKp, 5 * LAMPORTS_PER_SOL));
      await Promise.all(airdropPromises);

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

    await test_init(); // set defaults
  });

  it("initializes the contract", async () => {
    await test_init();
  });

  it("base - creates an auction", async () => {
    await test_create_auction_KP0();
  });

  it("base - places a bid", async () => {
    await test_create_auction_KP0();
    await test_bid_auction(0.1);
  });

  it("cancels - only during auction period", async () => {
    await test_create_auction_KP0(0.05, 1); // 36s

    const bidResult1 = await test_bid_auction(0.1, USER_KPs[1]);
    await test_cancel_bid(USER_KPs[1]); // cancel the first bid within the auction period (should succeed)

    const bidResult2 = await test_bid_auction(0.1, USER_KPs[2]);
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
    await test_create_auction_KP0();

    const bidResult1 = await test_bid_auction(0.5, USER_KPs[1]);
    const bidResult2 = await test_bid_auction(0.3, USER_KPs[2]);

    await test_cancel_bid(USER_KPs[1]);
    let { auctionSol, } = await test_cancel_bid(USER_KPs[2]);

    const auctionSolBalance = await connection.getBalance(auctionSol);
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction");

  });

  it("cancels - bids from same user", async () => {
    await test_create_auction_KP0();

    await test_bid_auction(0.5, USER_KPs[1]);
    await test_bid_auction(0.3, USER_KPs[1]);

    let { auctionSol: auctionSol1, } = await test_cancel_bid(USER_KPs[1]);
    const auctionSolBalance1 = await connection.getBalance(auctionSol1);
    assert.equal(auctionSolBalance1 == 0, true, "should be no sol left in the auction");

    await test_bid_auction(0.5, USER_KPs[1]);
    await test_bid_auction(0.3, USER_KPs[1]);
    await test_bid_auction(0.1, USER_KPs[2]);

    let { auctionSol: auctionSol2, } = await test_cancel_bid(USER_KPs[2]);
    const auctionSolBalance2 = await connection.getBalance(auctionSol2);
    assert.equal(auctionSolBalance2 > 0, true, "should be sol left in the auction");

    let { auctionSol: auctionSol3, } = await test_cancel_bid(USER_KPs[1]);
    const auctionSolBalance3 = await connection.getBalance(auctionSol2);
    assert.equal(auctionSolBalance3 == 0, true, "should be no sol left in the auction");
  });

  it("base - user can bid twice", async () => {
    await test_create_auction_KP0();
    await test_bid_auction(0.1);
    await test_bid_auction(0.1);
  });  

  it("fills - auction fully filled", async () => {
    await test_create_auction_KP0();
    await test_bid_auction(1.0); // fill
  });

  it("fills - no bids after filled", async () => {
    //if (isLocal) {
    await test_create_auction_KP0();
      await test_bid_auction(0.5);
      await test_bid_auction(0.5); // fill auction
      try {
        await test_bid_auction(0.1); // must fail
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

  it("admin - creates & interacts with a v2 pool", async () => {
    await test_create_pool_and_trade();
  });

  it("admin - no withdraws during auction", async () => {
    await test_admin_withdraws({ n_bids: 1, withdraw_tokens: false, withdraw_sol: true, fill_auction: false });
    await test_admin_withdraws({ n_bids: 1, withdraw_tokens: true, withdraw_sol: false, fill_auction: false });
  });

  it("admin - withdraws after auction with 2 distinct bids", async () => {
    await test_admin_withdraws({ n_bids: 2, withdraw_tokens: false, withdraw_sol: true, fill_auction: true });
    await test_admin_withdraws({ n_bids: 2, withdraw_tokens: true, withdraw_sol: false, fill_auction: true });
  });


  it("claims - failed auction: min total sol not reached", async () => {
    await test_init(10000); // 10k SOL minimum needed to move liquidity - will cause this auction to finished failed

    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)

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
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[0]);
    const bidResult2 = await test_bid_auction(0.5, USER_KPs[1]); // Full fill

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
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction");
  });

  it("claims - failed auction: full supply not bid", async () => {
    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[0]);
    const bidResult2 = await test_bid_auction(0.3, USER_KPs[1]);
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
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction");
  });

  it("claims - failed auction: same user claims multiple bids", async () => {
    await test_init(10000); // 10k SOL minimum needed to move liquidity - will cause this auction to finished failed
    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[1]);
    const bidResult2 = await test_bid_auction(0.3, USER_KPs[1]);
    const bidResult3 = await test_bid_auction(0.2, USER_KPs[2]);

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
    assert.equal(auctionSolBalance == 0, true, "should be no sol left in the auction");
  });

  it("claims - only after auction is finished", async () => {
    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[1]);
    const bidResult2 = await test_bid_auction(0.3, USER_KPs[1]);

    try {
      await test_claim_auction(USER_KPs[1], false);
    }
    catch (err) {
      console.log("Expected Error: ", err);
      assert.equal(err.toString().includes("AuctionNotFinished"), true, "should only be able to claim after auction is finished");
    }
  });

  it("claims - successful auction - auction creator bids & claims", async () => {
    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[0]);
    const bidResult2 = await test_bid_auction(0.5, USER_KPs[1]);

    await test_claim_auction(USER_KPs[0], true, bidResult1); // creator claims
  });

  it("claims - successful auction", async () => {
    await test_e2e_auction_success();
  });

  it("admin - withdraws & movesliq before claims", async () => {
    await test_e2e_auction_success();
  });

  async function test_e2e_auction_success() {
    await test_create_auction_KP0(0.05, 1); // 5% lock, 1 hour/100 duration (~36s)

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);

    // bids
    const bidResult1 = await test_bid_auction(0.5, USER_KPs[0]);
    await sleep(3);
    const bidResult2 = await test_bid_auction(0.3, USER_KPs[1]);
    await sleep(3);
    const bidResult3 = await test_bid_auction(0.2, USER_KPs[2]); // will moveliq on devnet...
    assert.deepEqual(bidResult3.auctionPost.lastStatus, { succeeded: {} }, "expected succeeded"); // expect this on LAST FILLING BID

    var auctionPost = await program.account.auction.fetch(auctionData);
    var auctionSolBalance = await connection.getBalance(auctionSol);
    auctionPost.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    // claims
    const { solTransferred: solTransferred1, tokensTransferred: tokensTransferred1 } = await test_claim_auction(USER_KPs[0], true, bidResult1);
    const { solTransferred: solTransferred2, tokensTransferred: tokensTransferred2 } = await test_claim_auction(USER_KPs[1], true, bidResult2);
    const { solTransferred: solTransferred3, tokensTransferred: tokensTransferred3 } = await test_claim_auction(USER_KPs[2], true, bidResult3);

    // first bidder should get change, & tokens
    assert.equal(solTransferred1 > 0, true, "first bidder should get change");
    assert.equal(tokensTransferred1 > 0, true, "first bidder should get tokens");

    // same for second bidder
    assert.equal(solTransferred2 > 0, true, "second bidder should get change");
    assert.equal(tokensTransferred2 > 0, true, "second bidder should get tokens");

    // last bidder gets no change, but gets tokens
    assert.equal(solTransferred3 == 0, true, "last bidder should get no change");
    assert.equal(tokensTransferred3 > 0, true, "last bidder should get tokens");

    // check correct amount of sol is left in the auction...
    auctionPost = await program.account.auction.fetch(auctionData);
    auctionSolBalance = await connection.getBalance(auctionSol);
    auctionPost.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    const clearingPrice = auctionPost.clearingPrice;
    console.log(`clearingPrice sol`, clearingPrice.toNumber() / LAMPORTS_PER_SOL);

    if (isLocal) {
      const expectedTotalChange = new BN(auctionPost.bids.map((bid) => {
        // if no liqmove took place
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
        new BN(auctionPost.bids.map((bid) => bid.bidSol.toNumber() * bid.bidQty.toNumber() - bid.bidFee.toNumber()).reduce((a, b) => a + b, 0)) // net ins
          .sub(expectedTotalChange);
      console.log(`expectedSolInAuction`, expectedSolInAuction.toNumber() / LAMPORTS_PER_SOL);

      console.log(`auctionSolBalance`, auctionSolBalance.toString() / LAMPORTS_PER_SOL);
      assert.equal(auctionSolBalance.toString(), expectedSolInAuction.toString(), "should be correct amount of sol left in the auction");
    }
    else {
      // liqmove happened and claims happened...
      console.log(`auctionSolBalance`, auctionSolBalance.toString() / LAMPORTS_PER_SOL);
      assert.equal(auctionSolBalance < 0.001, true, "should be no sol left in the auction"); // life is short
    }
  }

  async function test_claim_auction(bidderKp: Keypair, assumeSuccessAuction: boolean = true, bidResult: any = undefined): Promise<{ solTransferred: number, tokensTransferred: number }> {
    logger.color("magenta").log(`${bidderKp.publicKey} is claiming...`);

    // **Derive PDAs**
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1; // Claim against the last auction
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    //console.log("auctionId", auctionId, "auctionSol", auctionSol.toBase58(), "auctionData", auctionData.toBase58());
    const auctionPre = await program.account.auction.fetch(auctionData);
    logObject("auctionPre", auctionPre);
    auctionPre.bids.forEach((bid) => {
      console.log("bid", bid.bidder.toBase58(), `qty`, bid.bidQty.toNumber(), `price sol`, bid.bidSol.toNumber() / LAMPORTS_PER_SOL, `fee sol`, bid.bidFee.toNumber() / LAMPORTS_PER_SOL, `isClaimed`, bid.isClaimed);
    });

    // **Find all unclaimed bids for the bidder**
    const unclaimedBids = auctionPre.bids.filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed);
    assert.equal(unclaimedBids.length > 0, true, "No unclaimed bids found for bidder");

    // **Set up accounts for claim**
    const tokenMint = auctionPre.tokenMint;
    await getOrCreateAssociatedTokenAccount(connection, bidderKp, tokenMint, bidderKp.publicKey); // Create ATA - we don't want ATA setup costs to screw up our arithmetic
    const callerTokenAccount = await getAssociatedTokenAddress(tokenMint, bidderKp.publicKey);
    const auctionTokenAccount = await getAssociatedTokenAddress(tokenMint, auctionSol, true); // Allow off-curve owner

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
    //console.log(`Balances after claim: Bidder SOL: ${(bidderSolAfter / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${bidderTokenAfter}, Auction SOL: ${(auctionSolAfter / LAMPORTS_PER_SOL).toFixed(10)}, Tokens: ${auctionTokenAfter}`);

    // **Calculate actual transfers**
    const bidFee = bidResult.feeIncreaseBN.toNumber();
    const solTransferredToBidder = bidderSolAfter - bidderSolBefore + networkFee + bidFee; // Adjust for network and bid fees paid by bidder
    const tokensTransferredToBidder = bidderTokenAfter - bidderTokenBefore;
    const solTransferredFromAuction = auctionSolBefore - auctionSolAfter;
    const tokensTransferredFromAuction = parseInt(auctionTokenBefore) - parseInt(auctionTokenAfter);
    //console.log(`solTransferredToBidder: ${(solTransferredToBidder / LAMPORTS_PER_SOL).toFixed(6)}, Tokens to bidder: ${tokensTransferredToBidder}`);
    //console.log(`solTransferredFromAuction: ${(solTransferredFromAuction / LAMPORTS_PER_SOL).toFixed(6)}, Tokens from auction: ${tokensTransferredFromAuction}`);

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
    const remainingUnclaimedBids = auctionPost.bids.filter((b: any) => b.bidder.equals(bidderKp.publicKey) && !b.isClaimed);
    assert.equal(remainingUnclaimedBids.length, 0, "All unclaimed bids should be marked as claimed");

    // **Return totals**
    return {
      solTransferred: solTransferredFromAuction,
      tokensTransferred: tokensTransferredToBidder,
    };
  }

  async function test_admin_withdraws({ n_bids = 1, withdraw_tokens = false, withdraw_sol = false, fill_auction = false }) {
    // Step 1: Create an auction and place bid(s) to populate the auction with SOL and tokens
    await test_create_auction_KP0();
    for (var i = 0; i < n_bids; i++) {
      const kp = USER_KPs[i % USER_KPs.length];
      await test_bid_auction(0.5 / n_bids, kp); // bid up to half supply
    }
    if (fill_auction) {
      await test_bid_auction(0.5, USER_KPs[0]); // fill auction if requested
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
    const lockPercent = auctionDataFetched.lockPercent.toNumber(); // Convert BN to number (1 to 1000)
    const amountToWithdraw = (auctionTokenBefore * BigInt(lockPercent)) / BigInt(1000); // Calculate tokens to withdraw
    const expectedAuctionTokenAfter = auctionTokenBefore - amountToWithdraw; // Remaining tokens in auction
    const expectedAdminTokenAfter = adminTokenBefore + amountToWithdraw; // Admin's new balance
    console.log(`lockPercent: ${lockPercent}`);
    console.log(`amountToWithdraw: ${amountToWithdraw.toString()}`);
    console.log(`expectedAuctionTokenAfter: ${expectedAuctionTokenAfter.toString()}`);
    console.log(`expectedAdminTokenAfter: ${expectedAdminTokenAfter.toString()}`);
  
    // Step 4: Withdraw SOL
    const callAs = adminKp;
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
  
    // Step 5: Withdraw Tokens
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
        assert.ok(auctionSolAfter >= 890880, "Auction SOL account should retain at least rent-exempt minimum");
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
    }
  }

  async function test_create_pool_and_trade() { // https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/amm
    if (isLocal) { logger.color("yellow").log("Skipping pool creation on localnet"); return; }
    const adminBalanceAtStart = await connection.getBalance(adminKp.publicKey);
    const txVersion = TxVersion.LEGACY; // TxVersion.V0
    const LIQ_SOL = 0.1; // max one decimal please
    const SUPPLY_TOKENS = 1_000_000_000; //1_000_000;
    const SUPPLY_DECIMALS = 9;
    const LIQ_TOKENS = SUPPLY_TOKENS * 0.1;

    // **Step 1: Set up connection and keypairs && Initialize the Raydium SDK **
    const minterKp = adminKp; //Keypair.generate();
    const raydium = await Raydium.load({ connection, owner: minterKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });
    logger.color("green").log("Raydium SDK loaded");

    // **Step 2: Mint a new fucking token**
    const tokenMint = await createMint(connection, minterKp, minterKp.publicKey, null, SUPPLY_DECIMALS);
    const minterTokenAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, tokenMint, minterKp.publicKey); // ATA
    const totalSupply = new BN(SUPPLY_TOKENS).mul(new BN(10).pow(new BN(SUPPLY_DECIMALS)));
    await mintTo(connection, minterKp, tokenMint, minterTokenAccount.address, minterKp, BigInt(totalSupply.toString()));
    console.log('WSOLMint', WSOLMint.toBase58());
    console.log('tokenMint', tokenMint.toBase58());

    // Check that the tokens are there
    const tokenBalance = await connection.getTokenAccountBalance(minterTokenAccount.address);
    assert.equal(tokenBalance.value.uiAmount, SUPPLY_TOKENS, "Minter has wrong # of tokens after mint");
    logger.color("green").log("Minted tokens");

    // **Step 3: Wrap SOL into WSOL **
    console.log('TOKEN_WSOL.address', TOKEN_WSOL.address); // So11111111111111111111111111111111111111112
    const minterWsolAccount = await getOrCreateAssociatedTokenAccount(connection, minterKp, new PublicKey(TOKEN_WSOL.address), minterKp.publicKey);
    const wsolBalance = await connection.getTokenAccountBalance(minterWsolAccount.address); // Get current WSOL balance
    const currentWsolAmount = wsolBalance.value.uiAmount || 0; // Default to 0 if null
    console.log(`Current WSOL balance: ${currentWsolAmount} WSOL`);
    if (currentWsolAmount < LIQ_SOL) { // Check if we need to wrap more SOL
      const shortfall = LIQ_SOL - currentWsolAmount;
      const lamportsToWrap = Math.ceil(shortfall * LAMPORTS_PER_SOL);
      console.log(`Wrapping ${shortfall} SOL to reach ${LIQ_SOL} WSOL`);
      const wrapTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: minterKp.publicKey,
          toPubkey: minterWsolAccount.address,
          lamports: lamportsToWrap,
        }),
        createSyncNativeInstruction(minterWsolAccount.address)
      );
      wrapTx.feePayer = minterKp.publicKey;
      wrapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [minterKp]);
      await logSuccessTx(connection, wrapSig, "Wrapped minter's SOL into WSOL");
    }

    //
    // **Step 4: create a market ** ~1.9 SOL FEE TO CREATE A MARKET
    //
    //console.log('RAYMint', RAYMint.toBase58());
    //console.log('USDCMint', USDCMint.toBase58());
    var { execute: execCM, extInfo: extInfoCM, transactions: txsCM } = await raydium.marketV2.create({
      baseInfo: {
        // create market doesn't support token 2022
        mint: tokenMint, //RAYMint,
        decimals: SUPPLY_DECIMALS,
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
    const txIds = await execCM({ sequentially: true, });
    await logSuccessTx(connection, txIds.txIds[0], "Create market");
    const marketInfo = Object.keys(extInfoCM.address).reduce(
      (acc, cur) => ({ ...acc, [cur]: extInfoCM.address[cur as keyof typeof extInfoCM.address].toBase58(), }), {});
    console.log(`create market total ${txsCM.length} txs, market info: `, marketInfo);
    const marketId = new PublicKey(marketInfo['marketId']);
    //const marketId = new PublicKey('EGkf4X4XCdzH8dmefyL6dyj9oUqxu8q2YZEoEQMniiHo'); // sale devnet SOL - this costs 1.9 SOL
    console.log('marketId', marketId.toBase58());

    // **Step 5: Create a pool**
    const marketBufferInfo = await raydium.connection.getAccountInfo(new PublicKey(marketId));
    console.log('marketBufferInfo', marketBufferInfo);
    const { baseMint, quoteMint } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo!.data);
    const baseMintInfo = await raydium.token.getTokenInfo(baseMint);
    const quoteMintInfo = await raydium.token.getTokenInfo(quoteMint);
    console.log('baseMintInfo', baseMintInfo);
    console.log('quoteMintInfo', quoteMintInfo);
    console.log('TOKEN_PROGRAM_ID', TOKEN_PROGRAM_ID.toBase58());
    if (baseMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58() || quoteMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58()) {
      throw new Error('baseMint or quoteMint is not a supported token type');
    }
    const baseAmount = new BN(LIQ_TOKENS).mul(new BN(10).pow(new BN(SUPPLY_DECIMALS)));
    const quoteAmount = new BN(LIQ_SOL * 10).mul(new BN(10).pow(new BN(8)));
    console.log('baseAmount', baseAmount.toString());
    console.log('quoteAmount', quoteAmount.toString());

    console.log('baseAmount (tokens)', BigInt(baseAmount.toString()) / BigInt(10 ** SUPPLY_DECIMALS));
    console.log('quoteAmount (wsol)', BigInt(quoteAmount.toString()) / BigInt(10 ** 9));

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

    const tokenBalanceAfter = await connection.getTokenAccountBalance(minterTokenAccount.address);
    console.log('tokenBalanceAfter', tokenBalanceAfter);
    console.log('tokenBalanceAfter.value.uiAmount', tokenBalanceAfter.value.uiAmount);
    console.log('SUPPLY_TOKENS', SUPPLY_TOKENS);
    console.log('LIQ_TOKENS', LIQ_TOKENS);
    assert.equal(tokenBalanceAfter.value.uiAmount, SUPPLY_TOKENS - LIQ_TOKENS, "Minter has wrong # of tokens after pool creation");

    // get total admin cost to create market & pool
    const adminBalanceAtEnd = await connection.getBalance(adminKp.publicKey);
    const totalCost = adminBalanceAtEnd - adminBalanceAtStart;
    console.log('totalCost', totalCost);
    console.log('totalCost (SOL)', totalCost / LAMPORTS_PER_SOL);

    // test poolkeys - ignore
    /*const poolKeys = { // devnet pool: 4t7PN6oWscEqnqiSwRuTZXWosyshVD4qJpp7iJhffNdR8StTjRvuGKngw2uyuRpB1ihdK5WCbrwuF52RpXzL6PZW
      programId: 'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8',
      ammId: 'BpdmAjTjMDamyyEzShzjzMQnjfkrs1vn9amSQGJzxLMX',
      ammAuthority: 'DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC',
      ammOpenOrders: '2ZRHYYKB6t7Ko19M4v2LjhrnLX7npLHJNokya5kZMeNf',
      lpMint: '79UAW3WqbgaPQEbVsCdNK9MHmEiG6fJJv5gXvhAUHfWu',
      coinMint: 'HXGt4TmVWKmwGkGPwHP3Kp4T2Jd52NoieA7Gad9Bhkdb',
      pcMint: 'So11111111111111111111111111111111111111112',
      coinVault: '2diEnXLNHrMsDBcADYu2ubZCZtjWf1C63C1hN1pUZf5v',
      pcVault: '6QJZAhbQ9UDdSUVK12AzzEP5ArUcG64mrZMyD4wK1Nkp',
      withdrawQueue: '2hFbvzyQWbHNXqBWJxNV9JK7eFTuQcQtmANxsV7SVcuX',
      ammTargetOrders: 'CaUstCJsdT56uzk6JsBCxg6RyBuudYDyvcqNGSKAbuLo',
      poolTempLp: 'Hv5dTdndbvL9hw8sHQumsnwJtW2Xckj2Xwrhsea8kspE',
      marketProgramId: 'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj',
      marketId: 'FYiWxYY2w5L4wXGNCSK4ouvxTnP6CyPKmyb6B4jPye6T',
      ammConfigId: '8QN9yfKqWDoKjvZmqFsgCzAqwZBQuzVVnC388dN5RCPo',
      feeDestinationId: '3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR'
    };*/
  
    // **Step 6: Query the damn pool price**
    const poolId = poolKeys['ammId'];
    let poolInfo: AmmRpcData | undefined;
    const getPrice = async () => { 
      const poolInfos = await raydium.liquidity.getRpcPoolInfos([poolId]);
      const poolInfo = poolInfos[poolId];
      const price = new Decimal(poolInfo.quoteReserve.toString()).div(poolInfo.baseReserve.toString()).toNumber();
      logger.color("green").log(`Reserve ratios: ${price} WSOL per token`);
      logger.color("green").log(`poolInfo.poolPrice: ${poolInfo.poolPrice} WSOL per token`);
      return poolInfo;
    }
    poolInfo = await getPrice();
  
    //
    // **Step 7: Buy & sell some tokens **
    //
    const swap = async (buyTokens: boolean) => {
      const inputMint = buyTokens ? poolInfo.quoteMint.toBase58() : poolInfo.baseMint.toBase58();
      const amountIn = buyTokens ? 0.01 * 10 ** 9 // 0.01 WSOL 
        : 100_00 * 10 ** 6 // 10k TOKENS
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
      const [mintIn, mintOut] = baseIn ? [poolInfo2.mintA, poolInfo2.mintB] : [poolInfo2.mintB, poolInfo2.mintA]
      console.log('baseIn', baseIn);
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
      const SwapTx1 = await getTransactionDetailsWithRetry(connection, swapTx1Id);
      if (SwapTx1.meta.err) {
        throw new Error(`SwapTx1 failed: ${JSON.stringify(SwapTx1.meta.err)}`);
      }
      console.log(`${buyTokens ? 'bought' : 'sold'} tokens successfully in amm pool:`, swapTx1Id);
    }
    await swap(true);
    poolInfo = await getPrice();
    await swap(false);
    poolInfo = await getPrice();

    //
    // Step 9 - add some liquidity to the pool
    //
    //...

    //
    // Step 10 - remove some liquidity from the pool
    //
  }

  async function test_init(mintotal_sol: number = undefined) {  
    //logger.color("magenta").log("*** Initializing the auction system...");
    const signer = adminKp;

    //console.log("Program ID in test:", program.programId.toBase58());
    //console.log("signer.publicKey:", signer.publicKey.toBase58());
    //console.log("connection.rpcEndpoint", connection.rpcEndpoint);
    CONTRACT_CONFIG = {
      admin: adminKp.publicKey,
      defaultTokenSupply: new BN(TEST_TOKEN_SUPPLY),
      defaultTokenDecimals: TEST_TOKEN_DECIMALS,
      defaultStartPriceLamports: new BN(TEST_STARTPRICE_SOL * LAMPORTS_PER_SOL),
      feeAccount: TEST_FEE_ACCOUNT.publicKey,  //Keypair.generate().publicKey, 
      minTotalSol: new BN((mintotal_sol || TEST_MINTOTAL_SOL) * LAMPORTS_PER_SOL)
    };
    //logObject("newConfig", newConfig);

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const tx = await program.methods
      .initialize(CONTRACT_CONFIG)
      .accounts({
        signer: signer.publicKey,
      })
      .signers([signer])
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    try {
      var sig;
      try {
        sig = await sendAndConfirmTransaction(connection, tx, [signer]);
        await logSuccessTx(connection, sig, "initialize");    
      } catch (err) {
        logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs());
        throw err;
      }
      //const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo); 
      //logger.color("green").log("globalInfoAccount", globalInfoAccount);
      //const { deployer, config, auctionsNum } = globalInfoAccount;
      //logObject("globalInfoAccount", globalInfoAccount);

      //console.log("deployer", deployer.toString());
      //console.log("signer.publicKey", signer.publicKey.toString());
      //console.log("config.defaultTokenSupply", config.defaultTokenSupply.toString());
      //console.log("config.defaultTokenDecimals", config.defaultTokenDecimals.toString());
      //console.log("config.defaultStartPriceLamports", config.defaultStartPriceLamports.toNumber());
      //console.log("newConfig.feeAccount", config.feeAccount.toBase58());
      //console.log("newConfig.minTotalSol", config.minTotalSol.toNumber());

      await setupFeeAccount(connection, adminKp, CONTRACT_CONFIG.feeAccount);

    } catch (e) {
      console.error("Transaction error:", e);
      if (e.logs) {
        console.error("Transaction logs:", e.logs);
      }
      throw e;
    }
  }

  async function test_create_auction_KP0(
    auction_lock_percent = undefined, // 0-1
    duration_hours_div100 = undefined) {
    const signer = USER_KPs[0];

    logger.color("magenta").log(`${signer.publicKey.toBase58()} is creating auction...`);

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoTest = await program.account.globalInfo.fetchNullable(globalInfo);
    if (!globalInfoTest) throw ("Global Info not initialized!");

    // use a real ...maxi keypair if we're running e2e on devnet/mainnet
    const tokenKp1 = isLocal ? Keypair.generate() : Keypair.fromSecretKey(bs58.decode(await getAndLockMaxiPrivKey()));
    const token = tokenKp1;

    // test auction data
    const xId = new BN(42);
    const name = TEST_TOKEN_NAME;
    const symbol = TEST_TOKEN_SYMBOL;
    const uri = TEST_TOKEN_URI;
    const durationHours = new BN(duration_hours_div100 || 10); // about 5mins: unit is actually hours_div_100, or 36s 
    const lockPercent = new BN(auction_lock_percent * 1000 || TEST_LOCK_PERCENT); 
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
    console.log('durationHours', durationHours.toNumber());

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

    //try {
    //  console.log("*** simulateTransaction createAuction", await connection.simulateTransaction(tx));
    //}
    //catch (error) {
    //  console.error("Error during transaction signing or confirmation:", error);
    //  if (error instanceof Error && "getLogs" in error) {
    //    const logs = await error.getLogs;
    //    console.error("Simulation logs:", logs);
    //  }
    //  throw error;
    //}

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer, token]);
      await logSuccessTx(connection, sig, "createAuction");
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
    //console.log("auctionData", auctionData);

    const auctionDataFetched = await program.account.auction.fetch(auctionData);
    //logObject("auctionDataFetched", auctionDataFetched);

    // auction num
    //assert.equal(globalInfoAccount.auctionsNum, 1);

    // auction states
    assert.equal(parseFloat(auctionDataFetched.id.toString()), auctionId);
    assert.equal(auctionDataFetched.isFinished, false);
    assert.equal(auctionDataFetched.creator, signer.publicKey.toBase58());

    assert.equal(auctionDataFetched.tokenMint, token.publicKey.toBase58(), "tokenMint comparison");
  }

  async function test_bid_auction(fill_percent = 1.0, bidderKp = USER_KPs[1], useAuctionId = undefined) { // Bid all supply by default, lock 10% for AMM
    logger.color("magenta").log(`${bidderKp.publicKey} is bidding...`);

    // Derive PDAs
    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = useAuctionId || Number(globalInfoAccount.auctionsNum) - 1;
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8)], program.programId);
    console.log("auctionId", auctionId, "auctionSol", auctionSol.toBase58(), "auctionData", auctionData.toBase58());

    // Fetch pre-bid auction data
    const auctionPre = await program.account.auction.fetch(auctionData);
    //logObject("auctionPre", auctionPre);

    // Set up bidder and bid quantity
    const signer = bidderKp;
    const bidQty = new BN(auctionPre.tokenSupply.toNumber() / Math.pow(10, auctionPre.tokenDecimals) * fill_percent);
    //console.log("signer", signer.publicKey.toBase58(), "tokenSupply", auctionPre.tokenSupply.toString(), "bidQty", bidQty.toString());

    // Get initial balances
    const adminBalanceBefore = await connection.getBalance(adminKp.publicKey);
    const bidderBalanceBefore = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceBefore = await connection.getBalance(auctionSol);
    const feeAccountBalanceBefore = await connection.getBalance(CONTRACT_CONFIG.feeAccount); // Initial fee account balance
    //console.log(`Balances before bid: Bidder (${signer.publicKey.toBase58()}): ${(bidderBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL, Auction (${auctionSol.toBase58()}): ${(auctionSolBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL, Fee Account: ${(feeAccountBalanceBefore / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    // Check if bid fills auction
    const totalBidTokens = auctionPre.bids.reduce((acc, bid) => {
      return acc.add(bid.bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals))));
    }, new BN(0));
    const remainingTokens = auctionPre.tokenSupply.sub(totalBidTokens);
    const bidQtyLamports = bidQty.mul(new BN(Math.pow(10, auctionPre.tokenDecimals)));
    const isFinalBid = bidQtyLamports.gte(remainingTokens);
    //console.log('remainingTokens:', remainingTokens.toString());
    //console.log('bidQtyLamports:', bidQtyLamports.toString());
    console.log('isFinalBid:', isFinalBid);

    // **Step 1: Add event listener for NewBid event**
    let actualBidFeeBN;
    const listener = program.addEventListener("newBid", (event) => {
      actualBidFeeBN = new BN(event.bidFee);
      //console.log("Captured bid fee from event:", actualBidFeeBN.toString());
    });

    // Place bid transaction
    const tx = await program.methods.placeBid(bidQty, new BN(42))
      .accounts({
        bidder: signer.publicKey,
        auctionDataAccount: auctionData,
        auctionSolAccount: auctionSol,
        feeAccount: CONTRACT_CONFIG.feeAccount
      })
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer]).catch(err => {
      console.error("logs:", err.getLogs());
      throw err;
    });
    await logSuccessTx(connection, sig, "placeBid");

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
    const adminBalanceAfter = await connection.getBalance(adminKp.publicKey);
    const bidderBalanceAfter = await connection.getBalance(signer.publicKey);
    const auctionSolBalanceAfter = await connection.getBalance(auctionSol);
    const feeAccountBalanceAfter = await connection.getBalance(CONTRACT_CONFIG.feeAccount); // Final fee account balance
    const auctionPost = await program.account.auction.fetch(auctionData);
    const txDetails = await getTransactionDetailsWithRetry(connection, sig);
    const networkFee = txDetails.meta.fee; // Network transaction fee
    //logObject("auctionPost", auctionPost);

    // Calculate bid amount and use actual fee from event
    const lastBid = auctionPost.bids[auctionPost.bids.length - 1];
    const bidAmountBN = lastBid.bidQty.mul(lastBid.bidSol); // Total SOL paid by bidder (excluding network fee)
    const expectedAuctionSolIncreaseBN = bidAmountBN.sub(actualBidFeeBN); // Auction receives bid amount minus fee

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
    //console.log(`Fee account increase: ${(feeIncreaseBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Calculate minimum expected fee (1% of bidAmountBN)
    const minExpectedFeeBN = bidAmountBN.mul(new BN(1)).div(new BN(100)); // 1% of bid amount
    //console.log(`Minimum expected fee (1% of bid): ${(minExpectedFeeBN.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // **Validate that feeAccount increases by at least 1% of the SOL paid (excluding network fee)**
    assert.ok(feeIncreaseBN.gte(minExpectedFeeBN), `Fee account should increase by at least 1% of the bid amount. Actual increase: ${feeIncreaseBN.toString()}, Minimum expected: ${minExpectedFeeBN.toString()}`);

    // Validate based on bid type
    if (isFinalBid) {
      if (isLocal) {
        ;
      }
      else { // Check Raydium liquidity move worked ok
        //assert.equal(auctionSolBalanceAfter, 0, "All SOL should be withdrawn"); // Check all SOL withdrawn - NOT TRUE, if claims haven't happened yet...

        const lockPercent = auctionPost.lockPercent.toNumber(); // Calculate locked and expected remaining tokens
        const lockedTokensPercent = lockPercent / 10;
        const totalTokens = auctionPost.tokenSupply.toNumber();
        const lockedTokens = Math.floor((totalTokens * lockedTokensPercent) / 100);
        const expectedRemainingTokens = totalTokens - lockedTokens;

        const auctionTokenAccount = await getAssociatedTokenAddress(auctionPost.tokenMint, auctionSol, true); // Get auction token balance
        const auctionTokenBalance = await connection.getTokenAccountBalance(auctionTokenAccount);
        const remainingTokens = parseInt(auctionTokenBalance.value.amount);

        //console.log('lockPercent', lockPercent);
        //console.log('lockedTokensPercent', lockedTokensPercent);
        //console.log('totalTokens', totalTokens);
        //console.log('lockedTokens', lockedTokens);
        //console.log('expectedRemainingTokens', expectedRemainingTokens);
        //console.log('remainingTokens', remainingTokens);

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

      //console.log("adminBalanceBeforeBN", adminBalanceBeforeBN.toString());
      //console.log("adminBalanceAfterBN", adminBalanceAfterBN.toString());
      //console.log("bidderBalanceBeforeBN", bidderBalanceBeforeBN.toString());
      //console.log("bidderBalanceAfterBN", bidderBalanceAfterBN.toString());
      //console.log("bidAmountBN", bidAmountBN.toString());
      //console.log("networkFeeBN", networkFeeBN.toString());
      assert.equal(
        bidderBalanceBeforeBN.sub(bidderBalanceAfterBN).eq(bidAmountBN.add(networkFeeBN)),
        true,
        "Bidder SOL decrease should match bid amount plus network fee"
      );
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
    logObject("auctionDataBefore", auctionDataBefore);

    // Find all bids from the caller
    const callerBids = auctionDataBefore.bids.filter(b => b.bidder.equals(bidderKp.publicKey));
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
    cancelTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

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
    //logObject("auctionDataAfter", auctionDataAfter);

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
    const remainingBids = auctionDataAfter.bids.filter(b => b.bidder.equals(bidderKp.publicKey));
    assert.equal(remainingBids.length, 0, "All bids from the caller should be removed");

    return { auctionDataAfter, balanceAfter, balanceBefore, totalRefund, networkFee, auctionSol };
  }

  // it("User2 is claiming tokens from the auction", async () => {
  //   logger.color("magenta").log("User2 is claiming tokens from the auction...");
  //   const signer = USER_KPs[1];
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

});

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
  await sleep(3);
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
    //console.log("Transaction logs:", txDetails.meta.logMessages);
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

const VALID_PROGRAM_ID = new Set([
  AMM_V4.toBase58(),
  AMM_STABLE.toBase58(),
  DEVNET_PROGRAM_ID.AmmV4.toBase58(),
  DEVNET_PROGRAM_ID.AmmStable.toBase58(),
]);
const isValidAmm = (id: string) => VALID_PROGRAM_ID.has(id);

async function setupFeeAccount(connection: Connection, adminKp: Keypair, feeAccountPubkey: PublicKey) {
  const feeBalance = await connection.getBalance(feeAccountPubkey);
  const minBalance = await connection.getMinimumBalanceForRentExemption(0); // 0 bytes for a basic system account
  if (feeBalance < minBalance) {
    console.log("Funding fee account...");
    const lamportsToFund = minBalance - feeBalance;

    const transferIx = SystemProgram.transfer({
      fromPubkey: adminKp.publicKey,
      toPubkey: feeAccountPubkey,
      lamports: lamportsToFund
    });

    const tx = new Transaction().add(transferIx);
    tx.feePayer = adminKp.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);
    await logSuccessTx(connection, sig, "Funding fee account");
  } else {
    console.log(`Fee account already has sufficient balance for rent exemption.`);
  }
}