import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionSignature } from '@solana/web3.js';
import { describe, it } from 'mocha';
import { BN } from "bn.js";
import { Raydium, PoolUtils, TokenAmount, } from '@raydium-io/raydium-sdk-v2';
import keypair from "../id.json";
import "dotenv/config";
import * as sql from "mssql";
import "./logging";

// Database configuration (from your test suite)
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

// Instruction type mapping for decoding
const typeMap = {
    'SwapV2': 'swap',
    'OpenPositionV2': 'open_position',
    'ClosePositionV2': 'close_position',
    'CreatePool': 'create_pool',
};

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

    it('pools - clmm tx history and real-time monitor', async function () {
        this.timeout(0); // Disable timeout for real-time monitoring

        // Initialize Raydium SDK
        const raydium = await Raydium.load({
            connection,
            owner: adminKp,
            disableFeatureCheck: true,
            blockhashCommitment: 'confirmed',
        });

        // Fetch pool IDs from your database (replace with your actual fetch logic)
        const poolIds = await getPoolIdsFromDatabase(); // e.g., your list of 119 pool IDs
        if (!poolIds || poolIds.length === 0) {
            console.log('No pools to monitor');
            return;
        }
        console.log(`Fetched ${poolIds.length} pool IDs:`, poolIds);

        // Validate and filter pool IDs in parallel
        const validationPromises = poolIds
            .filter(poolIdStr => isValidPublicKey(poolIdStr))
            .map(async (poolIdStr) => {
                const poolId = new PublicKey(poolIdStr);
                const isValid = await isValidClmmPool(connection, poolId);
                return { poolIdStr, isValid };
            });

        const validationResults = await Promise.allSettled(validationPromises);
        const validPoolIds = validationResults
            .filter((result): result is PromiseFulfilledResult<{ poolIdStr: string; isValid: boolean }> =>
                result.status === 'fulfilled' && result.value.isValid)
            .map(result => result.value.poolIdStr);
        console.log(`Found ${validPoolIds.length} valid CLMM pool IDs`);

        if (validPoolIds.length === 0) {
            console.log('No valid CLMM pools to process');
            return;
        }

        // Process pools in parallel with concurrency limit
        const processedSignaturesByPool = new Map();
        const CONCURRENCY_LIMIT = 15; // Adjust based on your RPC rate limits

        console.log(`\n=== STARTING PARALLEL POOL PROCESSING ===`);
        console.log(`Processing ${validPoolIds.length} pools with concurrency limit of ${CONCURRENCY_LIMIT}`);

        // Global transaction data collector
        const poolTransactionData = new Map();

        // Helper function to process a single pool
        const processPool = async (poolIdStr: string, poolIndex: number) => {
            const startTime = Date.now();
            console.log(`\n[Pool ${poolIndex + 1}/${validPoolIds.length}] 🔄 Starting processing: ${poolIdStr}`);

            const poolId = new PublicKey(poolIdStr);
            processedSignaturesByPool.set(poolIdStr, new Set());

            // Initialize transaction data collection for this pool
            const poolTxData = {
                poolIdStr,
                historicalTxs: [],
                stats: { swaps: 0, positions: 0, other: 0 }
            };

            try {
                // Step 1: Fetch pool info
                console.log(`[Pool ${poolIndex + 1}] 📊 Fetching pool data from RPC...`);
                const poolDataStartTime = Date.now();
                const poolData = await raydium.clmm.getPoolInfoFromRpc(poolIdStr); // Fix: pass string instead of PublicKey
                const poolInfo = poolData.poolInfo;
                console.log(`[Pool ${poolIndex + 1}] ✅ Pool data fetched in ${Date.now() - poolDataStartTime}ms`);

                // Step 2: Fetch historical transactions
                console.log(`[Pool ${poolIndex + 1}] 📜 Fetching historical signatures...`);
                const signaturesStartTime = Date.now();
                const signatures = [];
                let before = null;
                let batchCount = 0;

                do {
                    batchCount++;
                    console.log(`[Pool ${poolIndex + 1}] 📦 Fetching signature batch ${batchCount}...`);
                    const result = await connection.getSignaturesForAddress(poolId, { before, limit: 1000 }, 'confirmed');
                    signatures.push(...result.map(res => res.signature));
                    before = result.length > 0 ? result[result.length - 1].signature : null;
                    console.log(`[Pool ${poolIndex + 1}] 📦 Batch ${batchCount}: ${result.length} signatures (total: ${signatures.length})`);
                } while (before);

                const signaturesTime = Date.now() - signaturesStartTime;
                console.log(`[Pool ${poolIndex + 1}] ✅ Found ${signatures.length} historical signatures in ${signaturesTime}ms`);

                // Step 3: Process transactions in parallel batches
                if (signatures.length > 0) {
                    console.log(`[Pool ${poolIndex + 1}] 🔄 Processing ${signatures.length} transactions...`);
                    const txStartTime = Date.now();
                    const processedSignatures = processedSignaturesByPool.get(poolIdStr);
                    const TX_BATCH_SIZE = 10; // Process transactions in smaller batches

                    for (let i = 0; i < signatures.length; i += TX_BATCH_SIZE) {
                        const batch = signatures.slice(i, i + TX_BATCH_SIZE);
                        console.log(`[Pool ${poolIndex + 1}] 🔄 Processing tx batch ${Math.floor(i / TX_BATCH_SIZE) + 1}/${Math.ceil(signatures.length / TX_BATCH_SIZE)} (${batch.length} txs)`);

                        const txPromises = batch.map(async (signature) => {
                            if (!processedSignatures.has(signature)) {
                                try {
                                    const tx = await connection.getTransaction(signature, {
                                        commitment: 'confirmed',
                                        maxSupportedTransactionVersion: 0
                                    });
                                    if (tx) {
                                        const txData = decodeTransaction(tx, poolInfo);
                                        poolTxData.historicalTxs.push(txData);

                                        // Update stats
                                        if (txData.type === 'swap') poolTxData.stats.swaps++;
                                        else if (txData.type === 'open_position' || txData.type === 'close_position') poolTxData.stats.positions++;
                                        else poolTxData.stats.other++;

                                        processedSignatures.add(signature);
                                        return true;
                                    }
                                } catch (error) {
                                    console.error(`[Pool ${poolIndex + 1}] ❌ Error processing tx ${signature}:`, error.message);
                                }
                            }
                            return false;
                        });

                        const results = await Promise.allSettled(txPromises);
                        const processed = results.filter(r => r.status === 'fulfilled' && r.value).length;
                        console.log(`[Pool ${poolIndex + 1}] ✅ Processed ${processed}/${batch.length} transactions in batch`);
                    }

                    const txTime = Date.now() - txStartTime;
                    console.log(`[Pool ${poolIndex + 1}] ✅ All transactions processed in ${txTime}ms`);
                }

                // Step 4: Set up real-time monitoring
                console.log(`[Pool ${poolIndex + 1}] 🔴 Setting up real-time monitoring...`);
                connection.onLogs(
                    poolId,
                    async (logs) => {
                        const signature = logs.signature;
                        const processedSignatures = processedSignaturesByPool.get(poolIdStr);
                        if (!processedSignatures.has(signature)) {
                            console.log(`[Pool ${poolIndex + 1}] 🆕 New transaction detected: ${signature}`);
                            try {
                                const tx = await connection.getTransaction(signature, {
                                    commitment: 'confirmed',
                                    maxSupportedTransactionVersion: 0
                                });
                                if (tx) {
                                    const txData = decodeTransaction(tx, poolInfo);
                                    // For real-time, we can log immediately since it's just one tx
                                    console.log(`[Pool ${poolIndex + 1}] 🆕 ${formatTransactionConcise(txData)}`);
                                    processedSignatures.add(signature);
                                }
                            } catch (error) {
                                console.error(`[Pool ${poolIndex + 1}] ❌ Error processing new tx ${signature}:`, error.message);
                            }
                        }
                    },
                    'confirmed'
                );

                // Store the collected transaction data
                poolTransactionData.set(poolIdStr, poolTxData);

                const totalTime = Date.now() - startTime;
                console.log(`[Pool ${poolIndex + 1}] 🎉 Pool processing completed in ${totalTime}ms - Now monitoring in real-time`);

                return { poolIdStr, success: true, signatures: signatures.length, time: totalTime, txData: poolTxData };
            } catch (error) {
                const totalTime = Date.now() - startTime;
                console.error(`[Pool ${poolIndex + 1}] ❌ Error processing pool ${poolIdStr} after ${totalTime}ms:`, error.message);
                return { poolIdStr, success: false, error: error.message, time: totalTime };
            }
        };

        // Process pools in parallel with concurrency limit
        const poolProcessingStartTime = Date.now();
        const results = [];

        for (let i = 0; i < validPoolIds.length; i += CONCURRENCY_LIMIT) {
            const batch = validPoolIds.slice(i, i + CONCURRENCY_LIMIT);
            console.log(`\n🚀 Processing pool batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(validPoolIds.length / CONCURRENCY_LIMIT)} (${batch.length} pools)`);

            const batchPromises = batch.map((poolIdStr, batchIndex) =>
                processPool(poolIdStr, i + batchIndex)
            );

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' }));

            console.log(`✅ Batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} completed`);
        }

        // Summary
        const totalProcessingTime = Date.now() - poolProcessingStartTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const totalSignatures = results.filter(r => r.success).reduce((sum, r) => sum + (r.signatures || 0), 0);

        console.log(`\n=== PARALLEL PROCESSING SUMMARY ===`);
        console.log(`✅ Successfully processed: ${successful}/${validPoolIds.length} pools`);
        console.log(`❌ Failed: ${failed}/${validPoolIds.length} pools`);
        console.log(`📊 Total signatures processed: ${totalSignatures}`);
        console.log(`⏱️  Total processing time: ${totalProcessingTime}ms`);
        console.log(`⚡ Average time per pool: ${Math.round(totalProcessingTime / validPoolIds.length)}ms`);
        console.log(`🔴 All pools now monitoring in real-time...`);

        // Consolidated transaction logging - one dense line per pool
        console.log(`\n=== HISTORICAL TRANSACTIONS SUMMARY ===`);
        console.log(`Format: [PoolID] Symbol | #Swaps #Positions #Other | Transactions`);
        console.log(`Legend: S(amt→amt)[sig] O[sig] C[sig] CP[sig]`);
        console.log(`─────────────────────────────────────────────────────────────────────────────────`);

        // Log successful pools with transaction data
        results
            .filter(r => r.success && r.txData)
            .sort((a, b) => b.txData.historicalTxs.length - a.txData.historicalTxs.length) // Sort by most active first
            .forEach(result => {
                logPoolTransactionsConsolidated(result.txData);
            });

        console.log(`─────────────────────────────────────────────────────────────────────────────────`);

        if (failed > 0) {
            console.log(`\n❌ Failed pools:`);
            results.filter(r => !r.success).forEach(r => {
                console.log(`  - ${r.poolIdStr}: ${r.error}`);
            });
        }

        // Keep the script running for real-time monitoring
        await new Promise(() => { });
    });

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
        console.log(`poolInfo.price: ${poolInfo.price}`);

        if (!poolInfo) {
            throw new Error('Pool info should be defined');
        }

        // Step 2 – make sure poolPrice is in TOKEN-per-SOL like the preview
        const rawPrice = Number(poolInfo.price); // mintB per mintA
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
        console.log(`currentPrice: ${currentPrice.toFixed(9)} tokens per SOL`);

        // executionPrice: Log as tokens per SOL
        console.log(`executionPrice: ${executionPrice.toFixed(9)} tokens per SOL`);

        // priceImpact: Convert to percentage
        console.log(`priceImpact: ${(priceImpact.mul(100)).toFixed(4)}%`);

        // fee: Convert lamports to SOL (assuming fee is in input token, SOL)
        const feeSol = fee.raw.toNumber() / 1e9;
        console.log(`fee: ${feeSol.toFixed(9)} SOL`);

        // Step 8: Calculate the implied price from the swap preview (without slippage)
        const inputAmountSol = amountIn.toNumber() / 1e9; // 1000 / 10^9 = 0.000001 SOL
        const outputAmountTokens = amountOut.amount.raw.toNumber() / Math.pow(10, tokenDecimals);
        const impliedPrice = outputAmountTokens / inputAmountSol; // tokens per SOL
        console.log(`\nSwap price: ${impliedPrice.toFixed(9)} tokens per SOL (output / input; before slippage)`);
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
            console.log(`    Token: ${reward.mint.symbol} (${reward.mint.address})`);
            console.log(`    Reward: ${JSON.stringify(reward)}`);
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
        console.log(`Total Value Locked (TVL): $${poolInfo.tvl.toFixed(9)}`);

        // Log day, week, and month metrics
        console.log('Daily Metrics:');
        console.log(`  Volume: $${poolInfo.day.volume.toFixed(2)}`);
        console.log('Weekly Metrics:');
        console.log(`  Volume: $${poolInfo.week.volume.toFixed(2)}`);
        console.log('Monthly Metrics:');
        console.log(`  Volume: $${poolInfo.month.volume.toFixed(2)}`);

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

});

/**
 * Formats a transaction in a very concise format for dense logging
 * @param {Object} txData - Transaction data object
 * @returns {string} Concise transaction representation
 */
function formatTransactionConcise(txData) {
    const shortSig = txData.signature.substring(0, 8);

    switch (txData.type) {
        case 'swap':
            if (txData.action === 'buy token with SOL') {
                return `S(${txData.amountIn.toFixed(6)}SOL→${txData.amountOut.toFixed(6)}TOK)[${shortSig}]`;
            } else if (txData.action === 'sell token for SOL') {
                return `S(${txData.amountIn.toFixed(6)}TOK→${txData.amountOut.toFixed(6)}SOL)[${shortSig}]`;
            } else {
                return `S(${txData.amountIn.toFixed(6)}→${txData.amountOut.toFixed(6)})[${shortSig}]`;
            }
        case 'open_position':
            return `O[${shortSig}]`;
        case 'close_position':
            return `C[${shortSig}]`;
        case 'create_pool':
            return `CP[${shortSig}]`;
        default:
            return `${txData.type}?[${shortSig}]`;
    }
}

/**
 * Logs all historical transactions for a pool in one dense line
 * @param {Object} poolTxData - Pool transaction data
 */
function logPoolTransactionsConsolidated(poolTxData) {
    const { poolIdStr, historicalTxs, stats } = poolTxData;
    const shortPoolId = poolIdStr.substring(0, 8);

    // Create concise transaction representations
    const txStrings = historicalTxs
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(tx => formatTransactionConcise(tx));

    // Group similar transactions for even more density
    const groupedTxs = groupSimilarTransactions(txStrings);

    console.log(`📊 [${shortPoolId}] | ${stats.swaps}S ${stats.positions}P ${stats.other}O | ${groupedTxs}`);
}

/**
 * Groups similar transactions to make the output even more dense
 * @param {string[]} txStrings - Array of transaction strings
 * @returns {string} Grouped transaction string
 */
function groupSimilarTransactions(txStrings) {
    if (txStrings.length === 0) return 'No historical txs';
    if (txStrings.length <= 10) return txStrings.join(' ');

    // For large numbers, show first few, count in middle, last few
    const first3 = txStrings.slice(0, 3);
    const last3 = txStrings.slice(-3);
    const middleCount = txStrings.length - 6;

    return `${first3.join(' ')} ...${middleCount}more... ${last3.join(' ')}`;
}

/**
 * Decodes a transaction and returns its details based on instruction type.
 * @param {Object} tx - The transaction object from getTransaction.
 * @param {Object} poolInfo - Pool information containing vault and mint details.
 * @returns {Object} Transaction details object
 */
function decodeTransaction(tx, poolInfo) {
    const logMessages = tx.meta.logMessages;
    let instructionName = 'unknown';

    // Extract instruction name from log messages
    for (const msg of logMessages) {
        if (msg.startsWith('Program log: Instruction: ')) {
            instructionName = msg.split(': ')[2] || 'unknown';
            break;
        }
    }

    const txType = typeMap[instructionName] || 'unknown';
    let action = 'unknown';
    let amountIn = 0;
    let amountOut = 0;

    if (txType === 'swap') {
        const accountKeys = tx.transaction.message.staticAccountKeys;
        const vaultAIndex = accountKeys.findIndex(key => key.equals(poolInfo.vaultA));
        const vaultBIndex = accountKeys.findIndex(key => key.equals(poolInfo.vaultB));

        if (vaultAIndex === -1 || vaultBIndex === -1) {
            console.log(`Transaction ${tx.transaction.signatures[0]}: Vaults not found in account keys`);
            return;
        }

        const preVaultA = tx.meta.preTokenBalances.find(b => b.accountIndex === vaultAIndex && b.mint === poolInfo.mintA.address);
        const postVaultA = tx.meta.postTokenBalances.find(b => b.accountIndex === vaultAIndex && b.mint === poolInfo.mintA.address);
        const preVaultB = tx.meta.preTokenBalances.find(b => b.accountIndex === vaultBIndex && b.mint === poolInfo.mintB.address);
        const postVaultB = tx.meta.postTokenBalances.find(b => b.accountIndex === vaultBIndex && b.mint === poolInfo.mintB.address);

        if (!preVaultA || !postVaultA || !preVaultB || !postVaultB) {
            console.log(`Transaction ${tx.transaction.signatures[0]}: Missing token balance data for vaults`);
            return;
        }

        const changeVaultA = parseFloat(postVaultA.uiTokenAmount.uiAmount || 0) - parseFloat(preVaultA.uiTokenAmount.uiAmount || 0);
        const changeVaultB = parseFloat(postVaultB.uiTokenAmount.uiAmount || 0) - parseFloat(preVaultB.uiTokenAmount.uiAmount || 0);
        const isMintASol = poolInfo.mintA.address === 'So11111111111111111111111111111111111111112';
        const isMintBSol = poolInfo.mintB.address === 'So11111111111111111111111111111111111111112';

        if (changeVaultA > 0 && changeVaultB < 0) {
            if (isMintASol) {
                action = 'buy token with SOL';
                amountIn = changeVaultA;
                amountOut = -changeVaultB;
            } else if (isMintBSol) {
                action = 'sell token for SOL';
                amountIn = changeVaultA;
                amountOut = -changeVaultB;
            }
        } else if (changeVaultA < 0 && changeVaultB > 0) {
            if (isMintBSol) {
                action = 'buy token with SOL';
                amountIn = changeVaultB;
                amountOut = -changeVaultA;
            } else if (isMintASol) {
                action = 'sell token for SOL';
                amountIn = changeVaultB;
                amountOut = -changeVaultA;
            }
        }
    } else if (txType === 'open_position') {
        action = 'open position';
    } else if (txType === 'close_position') {
        action = 'close position';
    } else if (txType === 'create_pool') {
        action = 'create pool';
    }

    return {
        signature: tx.transaction.signatures[0],
        type: txType,
        instruction: instructionName,
        action: action,
        amountIn: amountIn,
        amountOut: amountOut,
        timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'Unknown'
    };
}
// Function to fetch pool IDs from the database
async function getPoolIdsFromDatabase() {
    console.log("getPoolIdsFromDatabase", DB_CONFIG);
    const pool = new sql.ConnectionPool(DB_CONFIG);
    try {
        await pool.connect();
        const query = `
      SELECT DISTINCT pool_id
      FROM [dbo].[KeyPair]
      WHERE pool_id IS NOT NULL
    `;
        const result = await pool.request().query(query);
        const poolIds = result.recordset.map(row => row.pool_id);
        console.log(`Fetched ${poolIds.length} pool IDs from database`);
        return poolIds;
    } catch (error) {
        console.error('Error fetching pool IDs:', error);
        throw error;
    } finally {
        await pool.close();
    }
}

// Function to validate if a string is a valid Solana public key
function isValidPublicKey(address) {
    try {
        new PublicKey(address);
        return true;
    } catch {
        console.error(`Invalid pool ID: ${address} (not a valid public key)`);
        return false;
    }
}

// Function to check if a pool ID is a valid CLMM pool
async function isValidClmmPool(connection, poolId) {
    try {
        const accountInfo = await connection.getAccountInfo(poolId);
        if (!accountInfo) {
            console.error(`Pool ${poolId.toBase58()} has no account data`);
            return false;
        }

        const clmmProgramId_devnet = new PublicKey('devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH'); // devnet
        const clmmProgramId_mainnet = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'); // mainnet - TBC!!
        if (!accountInfo.owner.equals(clmmProgramId_devnet) && !accountInfo.owner.equals(clmmProgramId_mainnet)) {
            console.error(`Pool ${poolId.toBase58()} is not a CLMM pool (owned by ${accountInfo.owner.toBase58()})`);
            return false;
        }
        return true;
    } catch (error) {
        console.error(`Error validating pool ${poolId.toBase58()}:`, error);
        return false;
    }
}