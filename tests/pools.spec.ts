import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionSignature } from '@solana/web3.js';
import { describe, it } from 'mocha';
import { BN } from "bn.js";
import { Raydium, PoolUtils, TokenAmount, } from '@raydium-io/raydium-sdk-v2';
import keypair from "../id.json";

describe('CLMM Pools', () => {

    var providerEnv = anchor.AnchorProvider.env();
    console.log("rpcEndpoint URL:", providerEnv.connection.rpcEndpoint);

    const isLocal = providerEnv.connection.rpcEndpoint.indexOf("0.0.0.0") > -1;
    const isDevnet = providerEnv.connection.rpcEndpoint.indexOf("devnet") > -1;
    const isMainnet = isLocal == false && isDevnet == false;
    console.log("isLocal", isLocal);
    console.log("isDevnet", isDevnet);
    console.log("isMainnet", isMainnet);
    const connection = providerEnv.connection;
    const adminKp = Keypair.fromSecretKey(Uint8Array.from(keypair));

    it('pools - price & preview match', async () => {
        let raydium: Raydium;
        raydium = await Raydium.load({
            connection,
            owner: adminKp,
            disableFeatureCheck: true,
            blockhashCommitment: 'confirmed',
        });

        // Fixed pool ID and SOL mint
        const poolId = '3yi8R2ka192ZjMYmbN6s5HDdFBraNuLm1XtNfLxMbhgT';
        const solMint = 'So11111111111111111111111111111111111111112'; // SOL mint address
        const amountIn = new BN(1e3); // 0.000001 SOL

        // Step 1: Fetch pool information using getPoolInfoFromRpc
        const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
        const poolInfo = data.poolInfo;
        const clmmPoolInfo = data.computePoolInfo;
        const tickCache = data.tickData;
        console.log(`poolInfo.mintA: ${poolInfo.mintA.address}`);
        console.log(`poolInfo.mintB: ${poolInfo.mintB.address}`);
        console.log(`poolInfo.currentPrice: ${poolInfo.currentPrice}`);

        if (!poolInfo) {
            throw new Error('Pool info should be defined');
        }

        // Step 2 – make sure poolPrice is in TOKEN-per-SOL like the preview
        const rawPrice = Number(poolInfo.currentPrice); // mintB per mintA
        const poolPrice = solMint === poolInfo.mintA.address // is SOL the base?
            ? rawPrice // SOL is mintA ⇒ token per SOL
            : 1 / rawPrice; // SOL is mintB ⇒ invert to token per SOL

        // Step 3: Determine swap direction (baseIn: true if SOL is mintA, false if SOL is mintB)
        if (!(solMint === poolInfo.mintA.address || solMint === poolInfo.mintB.address)) {
            throw new Error('SOL must be one of the pool mints');
        }
        const baseIn = solMint === poolInfo.mintA.address;

        // Step 4: Set up swap preview parameters
        const tokenOut = baseIn ? poolInfo.mintB : poolInfo.mintA;
        const slippage = 0.01; // 1% slippage tolerance

        // Step 6: Compute the output amount for swapping 0.000001 SOL
        const {
            allTrade,
            realAmountIn,
            amountOut,
            minAmountOut,
            expirationTime,
            currentPrice,
            executionPrice,
            priceImpact,
            fee
        } = await PoolUtils.computeAmountOutFormat({
            poolInfo: clmmPoolInfo,
            tickArrayCache: tickCache[poolId],
            amountIn,
            tokenOut,
            slippage,
            epochInfo: await raydium.fetchEpochInfo(),
        });

        // Step 7: Log all computeAmountOutFormat return values in readable units
        console.log('\n=== Swap Preview Details ===');

        // allTrade: Log as JSON for inspection (structure may vary)
        console.log('allTrade:', JSON.stringify(allTrade, (key, value) =>
            typeof value === 'bigint' || value instanceof BN ? value.toString() : value, 2));

        // realAmountIn: Convert lamports to SOL
        const realAmountInSol = realAmountIn.amount.raw.toNumber() / 1e9;
        console.log(`realAmountIn: ${realAmountInSol} SOL`);

        // amountOut: Convert raw units to whole tokens
        const tokenDecimals = tokenOut.decimals; // 6 for mintB
        const amountOutTokens = amountOut.amount.raw.toNumber() / Math.pow(10, tokenDecimals);
        console.log(`amountOut: ${amountOutTokens} tokens`);

        // minAmountOut: Convert raw units to whole tokens
        const minAmountOutTokens = minAmountOut.amount.raw.toNumber() / Math.pow(10, tokenDecimals);
        console.log(`minAmountOut: ${minAmountOutTokens} tokens`);

        // expirationTime: Log as timestamp (assuming seconds)
        //console.log(`expirationTime: ${new Date(expirationTime * 1000).toLocaleString()} (Unix: ${expirationTime})`);

        // currentPrice: Log as tokens per SOL (assuming mintA = SOL)
        console.log(`currentPrice: ${currentPrice.toFixed(12)} tokens per SOL`);

        // executionPrice: Log as tokens per SOL
        console.log(`executionPrice: ${executionPrice.toFixed(12)} tokens per SOL`);

        // priceImpact: Convert to percentage
        console.log(`priceImpact: ${(priceImpact.mul(100)).toFixed(4)}%`);

        // fee: Convert lamports to SOL (assuming fee is in input token, SOL)
        const feeSol = fee.raw.toNumber() / 1e9;
        console.log(`fee: ${feeSol.toFixed(12)} SOL`);

        // Step 8: Calculate the implied price from the swap preview (without slippage)
        const inputAmountSol = amountIn.toNumber() / 1e9; // 1000 / 10^9 = 0.000001 SOL
        const outputAmountTokens = amountOut.amount.raw.toNumber() / Math.pow(10, tokenDecimals);
        const impliedPrice = outputAmountTokens / inputAmountSol; // tokens per SOL
        console.log(`\nSwap price: ${impliedPrice.toFixed(12)} tokens per SOL (output / input; before slippage)`);
        // Additional debug logs
        //console.log(`mintA decimals: ${poolInfo.mintA.decimals}`); // 9
        //console.log(`mintB decimals: ${poolInfo.mintB.decimals}`); // 6
        //console.log(`Raw amountOut: ${amountOut.amount.raw.toString()}`);

        // Step 9: Compare pool price with implied price
        const tolerance = 0.02; // 2% tolerance
        const priceDifference = Math.abs(poolPrice - impliedPrice);
        const allowedDifference = tolerance * poolPrice;
        console.log(`Pool price: ${poolPrice} tokens per SOL`);
        console.log(`Price difference: ${priceDifference}, Allowed difference: ${allowedDifference}`);
        if (priceDifference > allowedDifference) {
            throw new Error(`Pool price (${poolPrice}) and implied price (${impliedPrice}) should match within ${tolerance * 100}%`);
        }

        //
        // Pool Info
        //
        console.log('\n=== Pool Info Details ===');
        console.log(`Pool liquidity: ${poolInfo.liquidity}`);

        // Log basic string fields
        console.log(`Program ID: ${poolInfo.programId}`);
        console.log(`Pool ID: ${poolInfo.id}`);

        // Log token details (mintA and mintB)
        console.log(`Token A: ${poolInfo.mintA.symbol} (${poolInfo.mintA.address})`);
        console.log(`Token B: ${poolInfo.mintB.symbol} (${poolInfo.mintB.address})`);

        // Log rewardDefaultInfos array
        console.log('Reward Default Infos:');
        poolInfo.rewardDefaultInfos.forEach((reward, index) => {
            console.log(`  Reward ${index + 1}:`);
            console.log(`    Token: ${reward.token.symbol} (${reward.token.address})`);
            console.log(`    Rate: ${reward.rate}`); // Adjust based on actual property
        });

        // Log reward pool type
        console.log(`Reward Default Pool Type: ${poolInfo.rewardDefaultPoolInfos}`);

        // Log price with 6 decimal places for precision
        console.log(`Price: ${poolInfo.price.toFixed(6)} (Token B per Token A)`);

        // Convert mint amounts to human-readable format
        const amountA = poolInfo.mintAmountA / Math.pow(10, poolInfo.mintA.decimals);
        const amountB = poolInfo.mintAmountB / Math.pow(10, poolInfo.mintB.decimals);
        console.log(`Amount A: ${amountA.toFixed(6)} ${poolInfo.mintA.symbol}`);
        console.log(`Amount B: ${amountB.toFixed(6)} ${poolInfo.mintB.symbol}`);

        // Log fee rate as a percentage
        console.log(`Fee Rate: ${(poolInfo.feeRate).toFixed(2)}%`);

        // Parse and log openTime as a readable date
        const openDate = new Date(poolInfo.openTime);
        console.log(`Open Time: ${openDate.toLocaleString()}`);

        // Log TVL as a currency
        console.log(`Total Value Locked (TVL): $${poolInfo.tvl.toFixed(12)}`);

        // Log day, week, and month metrics
        console.log('Daily Metrics:');
        console.log(`  Volume: $${poolInfo.day.volume.toFixed(2)}`);
        console.log(`  Trades: ${poolInfo.day.trades}`);
        console.log('Weekly Metrics:');
        console.log(`  Volume: $${poolInfo.week.volume.toFixed(2)}`);
        console.log(`  Trades: ${poolInfo.week.trades}`);
        console.log('Monthly Metrics:');
        console.log(`  Volume: $${poolInfo.month.volume.toFixed(2)}`);
        console.log(`  Trades: ${poolInfo.month.trades}`);

        // Log pool types
        console.log('Pool Types:');
        poolInfo.pooltype.forEach((type, index) => {
            console.log(`  ${index + 1}. ${type}`);
        });

        // Log farm counts
        console.log(`Upcoming Farms: ${poolInfo.farmUpcomingCount}`);
        console.log(`Ongoing Farms: ${poolInfo.farmOngoingCount}`);
        console.log(`Finished Farms: ${poolInfo.farmFinishedCount}`);

        // Log burn percentage
        console.log(`Burn Percent: ${(poolInfo.burnPercent * 100).toFixed(2)}%`);

    });

    it('pools - clmm tx history', async function () {
        // Set Mocha timeout to 16.67 minutes (1,000,000 ms) as specified in the invocation
        this.timeout(1000000);

        // Establish connection to Solana mainnet
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

        // Hard-coded pool ID (replace with your actual pool ID)
        const poolId = new PublicKey('3yi8R2ka192ZjMYmbN6s5HDdFBraNuLm1XtNfLxMbhgT');

        // Step 1: Fetch all transaction signatures involving the pool address
        console.log(`Fetching transaction signatures for pool: ${poolId.toBase58()}`);
        const signatures: TransactionSignature[] = [];
        let before: string | null = null;
        let fetchCount = 0;

        try {
            do {
                const result = await connection.getSignaturesForAddress(poolId, {
                    before,
                    limit: 1000, // Max allowed by Solana API per request
                });
                signatures.push(...result.map((res) => res.signature));
                before = result.length > 0 ? result[result.length - 1].signature : null;
                fetchCount += result.length;
                console.log(`Fetched ${fetchCount} signatures so far...`);
            } while (before);
        } catch (error) {
            console.error('Error fetching signatures:', error);
            throw new Error('Failed to retrieve transaction signatures');
        }

        console.log(`Total signatures found: ${signatures.length}`);

        // Step 2: Define transaction type mapping based on expected instruction names
        const typeMap: { [key: string]: string } = {
            'InitializePool': 'creation',
            'Swap': 'swap',
            'IncreaseLiquidity': 'liquidity',
            'DecreaseLiquidity': 'liquidity',
            // Add more instruction names as needed based on Raydium V3 CLMM program
        };

        // Step 3: Process each transaction and classify based on logs
        console.log('\nProcessing transactions:');
        for (const signature of signatures) {
            try {
                const tx = await connection.getTransaction(signature, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0, // Support legacy transactions
                });

                if (!tx || !tx.meta || !tx.meta.logMessages) {
                    console.log(`Transaction ${signature}: No metadata or logs available`);
                    continue;
                }

                // Analyze log messages to determine transaction type
                let txType = 'unknown';
                let instructionName = 'unknown';
                for (const msg of tx.meta.logMessages) {
                    if (msg.startsWith('Instruction: ')) {
                        instructionName = msg.split(': ')[1] || 'unknown';
                        txType = typeMap[instructionName] || 'unknown';
                        break; // Assume first instruction is the primary action
                    }
                }

                console.log(`Transaction ${signature}: ${txType} (Instruction: ${instructionName})`);
            } catch (error) {
                console.error(`Error fetching transaction ${signature}:`, error);
                // Continue to next transaction on error
            }
        }

        // Optional: Add assertions if desired
        // Example: expect(signatures.length).to.be.greaterThan(0, 'No transactions found for the pool');
    });
});