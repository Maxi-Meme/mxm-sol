import * as anchor from "@coral-xyz/anchor";
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
    TOKEN_PROGRAM_ID,
  } from "@solana/spl-token";
import { Raydium, TxVersion, DEVNET_PROGRAM_ID, WSOLMint, AMM_V4, OPEN_BOOK_PROGRAM, FEE_DESTINATION_ID, MARKET_STATE_LAYOUT_V3, TOKEN_WSOL, } from '@raydium-io/raydium-sdk-v2';
import { getMint, getOrCreateAssociatedTokenAccount, createSyncNativeInstruction } from '@solana/spl-token';
  
import { Connection, Keypair } from "@solana/web3.js";
 
import { Program } from "@coral-xyz/anchor";
import { MaxiAuction } from "../target/types/maxi_auction";
  
  const GLOBAL_INFO_SEED = "global_info_seed";
  const AUCTION_SOL_SEED = "auction_sol_seed";
  const AUCTION_DATA_SEED = "auction_data_seed";


  // migrate auction liquidity to a new raydium pool
  export const migrateAuction = async (program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, adminKp: Keypair, connection: Connection) => {
    
    // Withdraw tokens (some) & sol (all) to admin
    const { solAmount: solWithdrawn, tokenAmount: tokensWithdrawn, tokenMint, adminTokenAccount } = await withdrawFunds(program, isMainnet, auctionId, adminKp, connection);
    console.log(`migrateAuction => Withdrawn ${solWithdrawn.toString()} lamports and ${tokensWithdrawn.toString()} tokens`);
  
    // Wrap all admin's SOL 
    const adminWsolAccount = await getOrCreateAssociatedTokenAccount(connection, adminKp, new PublicKey(TOKEN_WSOL.address), adminKp.publicKey);
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKp.publicKey,
        toPubkey: adminWsolAccount.address,
        lamports: solWithdrawn,
      }),
      createSyncNativeInstruction(adminWsolAccount.address)
    );
    wrapTx.feePayer = adminKp.publicKey;
    wrapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [adminKp]);
    console.log(`${wrapSig} migrateAuction => Wrapped SOL into WSOL`);
  
    // Create & fund a new market/pool
    const { marketId, poolId, marketInfo, poolKeys }  = await createAndFundPool(program, isMainnet, auctionId, tokenMint, tokensWithdrawn, solWithdrawn, adminKp, connection);
    console.log(`migrateAuction => OK!`);
    console.log(`  marketInfo`, marketInfo);
    console.log(`  poolKeys`, poolKeys);
    console.log(`  tokenMint: ${tokenMint.toBase58()}`);
    console.log(`  marketId: ${marketId.toBase58()}`);
    console.log(`  poolId: ${poolId.toBase58()}`);
    console.log(`  tokenAmount: ${tokensWithdrawn}`);
    console.log(`  solAmount: ${solWithdrawn}`);
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
      const withdrawSolSig = await program.methods 
        .withdrawSol()
        .accounts({
          admin: adminKp.publicKey,
          auctionDataAccount: auctionData,
          auctionSolAccount: auctionSol,
        })
        .signers([adminKp])
        .rpc();
      console.log(`withdrawFunds -> ${withdrawSolSig} migrateAuction (${auctionId}) => Withdrawn SOL`);
      const solAfter = BigInt(await connection.getBalance(auctionSol));
      const solWithdrawn = solBefore - solAfter;
    
      // Withdraw Tokens
      const tokenBefore = BigInt((await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount);
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
      console.log(`withdrawFunds -> ${withdrawTokenSig} migrateAuction (${auctionId}) => Withdrawn tokens`);
      const tokenAfter = BigInt((await connection.getTokenAccountBalance(auctionTokenAccount)).value.amount);
      const tokenWithdrawn = tokenBefore - tokenAfter;
    
      return { solAmount: solWithdrawn, tokenAmount: tokenWithdrawn, tokenMint, adminTokenAccount };
    }
  
    // (2) Create market and pool
    async function createAndFundPool(program: Program<MaxiAuction>, isMainnet: boolean, auctionId: number, tokenMint: PublicKey, tokenAmount: bigint, solAmount: bigint, adminKp: Keypair, connection: Connection): Promise<{ 
      marketId: PublicKey;
      poolId: PublicKey;
      marketInfo: Object;
      poolKeys: Object;
    }> {
      const raydium = await Raydium.load({connection, owner: adminKp, disableFeatureCheck: true, blockhashCommitment: 'finalized', });
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
        (acc, cur) => ({ ...acc, [cur]: extInfoCM.address[cur as keyof typeof extInfoCM.address].toBase58(), }), {} );
  
      // Create & fund the pool
      const marketBufferInfo = await raydium.connection.getAccountInfo(marketId);
      if (!marketBufferInfo) throw new Error('Failed to fetch market account info');
      const { baseMint, quoteMint } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo.data);
      const baseMintInfo = await raydium.token.getTokenInfo(baseMint);
      const quoteMintInfo = await raydium.token.getTokenInfo(quoteMint);
      if (baseMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58() || 
          quoteMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58()) {
        throw new Error('Base or quote mint is not a supported token type');
      }
      const baseAmount = new BN(tokenAmount.toString());
      const quoteAmount = new BN(solAmount.toString());
      console.log(`createAndFundPool -> baseAmount`, baseAmount.toString());
      console.log(`createAndFundPool -> quoteAmount`, quoteAmount.toString());
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
      console.log(`createAndFundPool -> ${cpSig} createAndFundPool (${auctionId}) => execCP OK`);
      const poolId = extInfoCP.address.ammId;
      const poolKeys = Object.keys(extInfoCP.address).reduce(
        (acc, cur) => ({ ...acc, [cur]: extInfoCP.address[cur as keyof typeof extInfoCP.address].toBase58(), }), {} );    
  
      return { marketId, poolId, marketInfo, poolKeys };
    }