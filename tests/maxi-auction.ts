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
import { DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk";

var connection;
var isLocal = false;

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
  // Fetch transaction details
  const txDetails = await connection.getTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0
  });

  // Log the transaction signature
  logger.color("green").log(`${label} transaction signature:`, sig);

  // Log the transaction logs if available
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

  connection = providerEnv.connection;
  const program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;

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

  program.addEventListener("auctionFilled", async (event) => { // Listen for 'auctionFilled' event
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
    const market = await createMarket(signer, coinMint); // *** Create market ***
    logObject("market", market);
    
    const [amm] = PublicKey.findProgramAddressSync([ammProgram.toBuffer(), market.toBuffer(), Buffer.from("amm_associated_seed")], ammProgram); // Derive AMM PDA
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
    
    const userTokenLp = await getAssociatedTokenAddress(lpMint, signer.publicKey, true); // Get user LP token account
    const nonce = 253; // Set nonce for AMM
    const openTime = new BN(Math.floor(Date.now() / 1000)); // Set pool open time
    const initPcAmount = new BN(0); // Set initial PC amount
    const initCoinAmount = new BN(0); // Set initial coin amount
    const tx = new Transaction(); // Create new transaction
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 })); // Set compute unit limit
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_200_000 })); // Set compute unit price
    tx.add(await program.methods.raydiumMigrate(nonce, openTime).accounts({ auctionSolAccount: auctionSol, auctionDataAccount: auctionData, auctionTokenAccount, ammProgram, amm, ammAuthority, ammOpenOrders, ammLpMint: lpMint, ammCoinMint: coinMint, ammPcMint: pcMint, ammCoinVault: coinVault, ammPcVault: pcVault, ammTargetOrders: targetOrders, ammConfig, createFeeDestination: feeDestination, market, userWallet: signer.publicKey, userTokenCoin, userTokenPc, userTokenLp }).signers([signer]).transaction()); // Add raydiumMigrate instruction
    tx.feePayer = signer.publicKey; // Set fee payer
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash; // Set recent blockhash
    
    var sig;
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [signer]); // *** migrate raydium ***
    }
    catch (err) {
      logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs());
      throw err;
    }
    logger.color("green").log("raydiumMigrate transaction signature", sig);
    await logSuccessTx(connection, sig, "raydiumMigrate");
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

  //   const market = await createMarket(signer, coinMint);
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
      //try {
        //var ok = false;
        //var tries = 0;
        //while (!ok) {
          try {
            //console.log("sendAndConfirmTransaction try", tries++);
            sig = await sendAndConfirmTransaction(connection, tx, [signer]);
          } catch (err) {
            logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs());
            throw err;
          }
          //ok = true;
        //}
      //}
      // catch (err) {
      //   logger.color("red").log("sendAndConfirmTransaction failed:", err.getLogs());
      //   throw err;
      // }
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
  });

  it("creates an auction", async () => {
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
  });

  it("creates a market", async () => {
    logger.color("magenta").log("admin is creating a market...");

    // Log balances of all signing accounts before the transaction
    const [adminBalance, ] = await Promise.all([
      connection.getBalance(adminKp.publicKey),
    ]);
    console.log("Balances before creating auction (in SOL):");
    console.log(`Admin (${adminKp.publicKey.toBase58()}): ${(adminBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

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
    const market = await createMarket(signer, coinMint);
    logObject("market", market);
  });


  it("fills an auction", async () => {
    logger.color("magenta").log("User2 is bidding...");

    const [globalInfo] = PublicKey.findProgramAddressSync([Buffer.from(globalInfoSeed)], program.programId);
    const globalInfoAccount = await program.account.globalInfo.fetch(globalInfo);
    const auctionId = Number(globalInfoAccount.auctionsNum) - 1;
    console.log("auctionId", auctionId);
    const [auctionSol] = PublicKey.findProgramAddressSync([Buffer.from(auctionSolSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),], program.programId);
    console.log("auctionSol", auctionSol);

    const [auctionData] = PublicKey.findProgramAddressSync([Buffer.from(auctionDataSeed), new anchor.BN(auctionId).toArrayLike(Buffer, "le", 8),], program.programId);
    console.log("auctionData", auctionData);

    const auctionDataFetched_Before = await program.account.auction.fetch(auctionData);
    logObject("auctionDataFetched_Before", auctionDataFetched_Before);

    const signer = user2Kp;
    const bidQty = auctionDataFetched_Before.tokenSupply; // BID ALL SUPPLY  //new BN(TestBidQty1);
    //const bidQty = new BN(TestBidQty1);
    //const bidSol = new BN(TestBidSol1 * LAMPORTS_PER_SOL);

    const [signerBalance,] = await Promise.all([
      connection.getBalance(signer.publicKey),
    ]);
    console.log("Balances before creating auction (in SOL):");
    console.log(`Signer (Bidder) (${signer.publicKey.toBase58()}): ${(signerBalance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

    const tx = await program.methods
      .placeBid(bidQty, new BN(42))
      .accounts({
        bidder: signer.publicKey,
        auctionDataAccount: auctionData,
        auctionSolAccount: auctionSol,
      })
      //.signers([signer])
      .transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // logge.color('connection').logr(await connection.simulateTransaction(tx));

    var sig; try {
      sig = await sendAndConfirmTransaction(connection, tx, [adminKp, signer]);
      await logSuccessTx(connection, sig, "placeBid");
    }
    catch (err) { console.error("logs:", await err.getLogs); throw err; }
    logger.color("green").log("placeBid transaction signature", sig);

    const auctionDataFetched_After = await program.account.auction.fetch(auctionData);
    logObject("auctionDataFetched_After", auctionDataFetched_After);
    assert.equal(auctionDataFetched_After.bids.length, 1, "bid length comparison");
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
