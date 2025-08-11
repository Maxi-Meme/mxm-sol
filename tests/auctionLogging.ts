// File: tests/auctionLogging.ts
import { DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { IS_LOCAL, IS_DEVNET, IS_MAINNET, getCurrentNetwork } from "./config";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getAccount } from '@solana/spl-token';


/* ===== Shapes (align with your project) ===== */
export interface PoolDbRow {
    market_info: string | null;
    pool_keys: string | null; // JSON with {mintA,mintB,decimalsA,decimalsB,vaultA,vaultB}
    market_id: string | null; // null/undefined for CLMM v3
    pool_id: string | null;   // Raydium pool id (Pubkey string)
}

export interface AuctionRow {
    auctionId: number | string;
    solBalanceAuctionData: string;
    solBalanceAuctionSol: string;
    solBalanceAuctionTokenAccount: string;
    rentExemptionAuctionData: string;
    rentExemptionAuctionSol: string;
    rentExemptionAuctionTokenAccount: string;
    tokenBalance: string;
    status: string;
    isFinalized: any;
    tokenMintPublicKey: string;
    clearingPrice: BN | null;
    solBalanceAuctionBids: string;
    rentExemptionAuctionBids: string;
    bidCountAuctionBids: number;
}

export type ClmmRpcData = {
    /** quote/base from Raydium SDK v2 */
    currentPrice: number;
};

/* ===== Raydium V3 HTTP API (subset) ===== */
type RaydiumV3PoolInfoItem = {
    id: string;
    mintA: string;
    mintB: string;
    price: string;
    mintAmountA?: string;
    mintAmountB?: string;
    burnPercent?: number;
};
type RaydiumV3ApiResponse<T> = { id: string; success: boolean; data: T };

/* ===== Module state ===== */
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const pad = (v: string | number, n: number) => String(v ?? "-").padEnd(n);

let apiInfoMap: Map<string, RaydiumV3PoolInfoItem> | null = null;
let apiInitPromise: Promise<Map<string, RaydiumV3PoolInfoItem>> | null = null;

let rpcConn: Connection | null = null;

/* ===== HTTP helpers ===== */
async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(t);
    }
}

async function fetchClmmPoolsInfoViaApiBatch(poolIds: string[], timeoutMs = 6000)
    : Promise<Map<string, RaydiumV3PoolInfoItem>> {
    const out = new Map<string, RaydiumV3PoolInfoItem>();
    const ids = Array.from(new Set(poolIds.filter(Boolean)));
    if (ids.length === 0) return out;

    const url = `https://api-v3.raydium.io/pools/info/ids?ids=${encodeURIComponent(ids.join(","))}`;
let res: Response;
try {
    res = await fetchWithTimeout(url, timeoutMs);
} catch (e) {
    console.log("Fetch timeout or error for Raydium API:", e);
    return out;
}
if (!res.ok) {
    console.log("Raydium API response not OK:", res.status, res.statusText);
    return out;
}

let json: RaydiumV3ApiResponse<unknown>;
try {
    json = await res.json() as RaydiumV3ApiResponse<unknown>;
} catch (e) {
    console.log("Failed to parse Raydium API JSON:", e);
    return out;
}
if (!json || (json as any).success !== true) {
    console.log("Raydium API response invalid or not success:", json);
    return out;
}

const dataRaw = (json as RaydiumV3ApiResponse<any>).data;
if (!Array.isArray(dataRaw)) {
    console.log("Raydium API data not an array:", dataRaw);
    return out;
}

for (const it of dataRaw) {
    if (it && typeof it === "object" && typeof (it as any).id === "string") {
        const item = it as RaydiumV3PoolInfoItem;
        out.set(item.id, item);
    }
}
return out;
}

/* ===== One-time API init with a proper lock (prevents races) ===== */
async function getApiMap(poolDbInfos: PoolDbRow[]): Promise<Map<string, RaydiumV3PoolInfoItem>> {
    if (apiInfoMap) return apiInfoMap;
    if (!apiInitPromise) {
        apiInitPromise = (async () => {
            try {
                const v3PoolIds = poolDbInfos
                    .filter(p => p?.pool_id && !p?.market_id)
                    .map(p => p!.pool_id!)
                    .filter(Boolean);
                const map = await fetchClmmPoolsInfoViaApiBatch(v3PoolIds);
                return map;
            } catch (e) {
                console.log("Unexpected error in getApiMap:", e);
                return new Map<string, RaydiumV3PoolInfoItem>();
            }
        })();
    }
    apiInfoMap = await apiInitPromise;
    if (!apiInfoMap) apiInfoMap = new Map<string, RaydiumV3PoolInfoItem>();
    return apiInfoMap;
}

async function fetchPoolPositionsInfo(
    poolIdStr: string,
    raydium: any,
    adminKp: any
): Promise<{ positionCount: number; lockedPositionCount: number; hasLockedPositions: boolean }> {
    try {
        // console.log(`\n=== Fetching position info for pool: ${poolIdStr} ===`, getCurrentNetwork());
        // console.log(`Admin public key: ${adminKp?.publicKey?.toBase58() || 'N/A'}`);

        // Get all owner positions using Raydium SDK
        const allPositions = await raydium.clmm.getOwnerPositionInfo({
            programId: IS_DEVNET ? DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID
                : new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
        });

        // Filter positions for this specific pool
        const poolPositions = allPositions.filter(pos =>
            pos.poolId.toBase58() === poolIdStr
        );

        // console.log(`Found ${poolPositions.length} position(s) for pool ${poolIdStr}`);

        let lockedPositionCount = 0;

        // Check each position for lock status (detailed logging commented out)
        for (const [index, position] of poolPositions.entries()) {
            // console.log(`\n--- Position ${index + 1} ---`);

            // Basic position analysis (no logging)
            const hasActiveLiquidity = position.liquidity && position.liquidity.gt && position.liquidity.gt(new BN(0));
            
            let hasActiveRewards = false;
            if (position.rewardInfos && Array.isArray(position.rewardInfos)) {
                for (const reward of position.rewardInfos) {
                    const hasRewardAmount = reward?.rewardAmountOwed && !reward.rewardAmountOwed.isZero();
                    const hasGrowth = reward?.growthInsideLastX64 && !reward.growthInsideLastX64.isZero();
                    if (hasRewardAmount || hasGrowth) {
                        hasActiveRewards = true;
                        break;
                    }
                }
            }

            // NFT Ownership Check for Lock Detection
            let isLocked = false;
            if (position.nftMint) {
                try {
                    //console.log(`🔍 [checkNFTOwnership] Checking ownership for position ${index + 1} NFT: ${position.nftMint.toString()}`);

                    // Derive ATA for NFT mint under admin (should be the owner if unlocked)
                    const adminAta = await getAssociatedTokenAddress(position.nftMint, adminKp.publicKey);
                    //console.log(`🔍 [checkNFTOwnership] Admin ATA: ${adminAta.toString()}`);

                    // Check if admin owns the NFT (amount=1 means they own it, unlocked)
                    let adminAccount;
                    let adminAmount = BigInt(0);
                    try {
                        adminAccount = await getAccount(raydium.connection, adminAta);
                        adminAmount = adminAccount.amount;
                        //console.log(`🔍 [checkNFTOwnership] Admin account found with amount: ${adminAmount.toString()}`);
                    } catch (error) {
                        if (error.name === 'TokenAccountNotFoundError') {
                            //console.log(`🔍 [checkNFTOwnership] Admin ATA not found (amount: 0)`);
                        } else {
                            throw error;
                        }
                    }

                    if (adminAmount === BigInt(1)) {
                        //console.log(`✅ [checkNFTOwnership] Position ${index + 1} is UNLOCKED - admin owns the NFT`);
                        isLocked = false;
                    } else {
                        //console.log(`🔒 [checkNFTOwnership] Position ${index + 1} is LOCKED - admin does not own the NFT (someone else has it)`);
                        isLocked = true;
                    }
                } catch (error) {
                    //console.log(`❌ [checkNFTOwnership] Error checking ownership for position ${index + 1}:`, error);
                    // If we can't determine ownership, assume it's locked for safety
                    isLocked = true;
                }
            }

            if (isLocked) {
                lockedPositionCount++;
            }
        }

        const positionCount = poolPositions.length;
        const hasLockedPositions = lockedPositionCount > 0;

        // console.log(`\n=== Summary for Pool ${poolIdStr} ===`);
        // console.log(`Total Positions: ${positionCount}`);
        // console.log(`Locked (Burn & Earn): ${lockedPositionCount}`);
        // console.log(`Regular Positions: ${positionCount - lockedPositionCount}`);

        return { positionCount, lockedPositionCount, hasLockedPositions };
    } catch (e) {
        console.log("Error fetching positions info:", e);
        return { positionCount: 0, lockedPositionCount: 0, hasLockedPositions: false };
    }
}

/* ===== On-chain fallback for devnet (vaultA/vaultB balances) ===== */
async function readVaultBalancesOnChain(
    poolRow: PoolDbRow
): Promise<{ solInPool?: number; tokenInPool?: number; otherMint?: string } | null> {
    try {
        //console.log("Starting readVaultBalancesOnChain for pool:", poolRow.pool_id);
        if (!poolRow?.pool_keys) {
            console.log("No pool_keys for pool:", poolRow.pool_id);
            return null;
        }

        let parsed: any;
        try {
            parsed = JSON.parse(poolRow.pool_keys);
            //console.log("Parsed pool_keys:", parsed);
        } catch (e) {
            console.log("Failed to parse pool_keys JSON:", e);
            return null;
        }

        const address = parsed.address || parsed.mockPoolInfo || {};
        if (!address) {
            console.log("No 'address' or 'mockPoolInfo' in parsed pool_keys");
            return null;
        }

        const mintA = String(address.mintA?.address ?? "");
        const mintB = String(address.mintB?.address ?? "");
        const decA = Number(address.mintA?.decimals ?? 9);
        const decB = Number(address.mintB?.decimals ?? 9);
        let vaultA: PublicKey | null = null;
        let vaultB: PublicKey | null = null;
        try {
            vaultA = address.vault?.A ? new PublicKey(address.vault.A) : null;
            vaultB = address.vault?.B ? new PublicKey(address.vault.B) : null;
            //console.log("vaultA:", vaultA?.toBase58(), "vaultB:", vaultB?.toBase58());
        } catch (e) {
            console.log("Invalid vault PublicKey:", e);
            return null;
        }

        if (!vaultA || !vaultB || !mintA || !mintB) {
            console.log("Missing required fields - mintA:", mintA, "mintB:", mintB, "vaultA:", !!vaultA, "vaultB:", !!vaultB, "decA:", decA, "decB:", decB);
            return null;
        }

        if (!rpcConn) {
            const endpoint = process.env.ANCHOR_PROVIDER_URL;
            if (!endpoint) {
                console.log("No ANCHOR_PROVIDER_URL defined");
                return null;
            }
            //console.log("Using RPC endpoint:", endpoint);
            try {
                rpcConn = new Connection(String(endpoint), { commitment: "confirmed" });
            } catch (e) {
                //console.log("Failed to create Connection:", e);
                return null;
            }
        }

        let balA, balB;
        try {
            balA = await rpcConn.getTokenAccountBalance(vaultA);
            //console.log("balA raw:", balA);
        } catch (e) {
            console.log("Error fetching balA for vaultA:", vaultA.toBase58(), e);
            balA = null;
        }

        try {
            balB = await rpcConn.getTokenAccountBalance(vaultB);
            //console.log("balB raw:", balB);
        } catch (e) {
            console.log("Error fetching balB for vaultB:", vaultB.toBase58(), e);
            balB = null;
        }

        const uiAmtA = balA?.value?.uiAmount ?? (balA?.value?.amount ? Number(balA.value.amount) / 10 ** decA : undefined);
        const uiAmtB = balB?.value?.uiAmount ?? (balB?.value?.amount ? Number(balB.value.amount) / 10 ** decB : undefined);
        //console.log("uiAmtA:", uiAmtA, "uiAmtB:", uiAmtB);

        const aIsSol = mintA === WSOL_MINT;
        const bIsSol = mintB === WSOL_MINT;
        //console.log("aIsSol:", aIsSol, "bIsSol:", bIsSol);

        if (!aIsSol && !bIsSol) {
            console.log("Neither mint is WSOL");
        }

        const solInPool = aIsSol ? uiAmtA : bIsSol ? uiAmtB : undefined;
        const tokenInPool = aIsSol ? uiAmtB : bIsSol ? uiAmtA : undefined;
        const otherMint = aIsSol ? mintB : bIsSol ? mintA : (mintA || "?");

        //console.log("Computed: solInPool:", solInPool, "tokenInPool:", tokenInPool, "otherMint:", otherMint);

        return { solInPool, tokenInPool, otherMint };
    } catch (e) {
        console.log("Unexpected error in readVaultBalancesOnChain:", e);
        return null;
    }
}

/* ===== PUBLIC: same signature you already call ===== */
export async function logAuctionInfo(
    poolDbInfos: PoolDbRow[],
    index: number,
    poolPpcInfosMapv3: Map<string, ClmmRpcData>,
    x: AuctionRow,
    raydium?: any,
    adminKp?: any
): Promise<void> {
    try {
        // Initialize API map once (mainnet-only data; devnet likely empty)
        const apiMap = await getApiMap(poolDbInfos);

        const poolDbInfo = poolDbInfos[index];
        const poolId = poolDbInfo?.pool_id ?? null;

        // Helper function to format balance - show ">0" if balance > 0, otherwise show "-"
        const formatBalance = (balance: string | null | undefined): string => {
            if (!balance || balance === "-") return "-";
            const numBalance = parseFloat(balance);
            return numBalance > 0 ? ">0" : "-";
        };

        // Helper function to truncate mint address
        const truncateMint = (mint: string): string => {
            if (!mint || mint.length <= 12) return mint;
            return `${mint.slice(0, 6)}...${mint.slice(-4)}`;
        };

        const baseLine =
            `ID: ${pad(x.auctionId.toString(), 3)}, ` +
            `[${pad(x.status ?? "-", 25)}], ` +
            `AD: ${pad(formatBalance(x.solBalanceAuctionData), 3)} ` +
            `AS: ${pad(x.solBalanceAuctionSol ?? "-", 12)} ` +
            `AT: ${pad(formatBalance(x.solBalanceAuctionTokenAccount), 3)} ` +
            `AB(${x.bidCountAuctionBids || 0}): ${pad(formatBalance(x.solBalanceAuctionBids), 3)} ` +
            //`T/s: ${pad(parseInt(x.tokenBalance).toString(), 12)}, ` +
            `Mint: ${truncateMint(x.tokenMintPublicKey)} ` +
            `CP: ${pad(x.clearingPrice ? (x.clearingPrice.toNumber() / LAMPORTS_PER_SOL).toFixed(10) : "-", 12)} ` +
            `Pool: ${poolId ? "✅" : "-"}`;

        if (!poolId) {
            console.log(baseLine);
            return;
        }

        const v3 = poolPpcInfosMapv3.get(poolId);
        if (!v3) {
            console.log(baseLine);
            return;
        }

        const poolPrice = v3.currentPrice ?? NaN; // quote/base
        let v3Line = "";

        // MAINNET path (if API has this pool)
        const apiInfo = apiMap.get(poolId) ?? null;
        if (apiInfo) {
            console.log("Using API info for pool:", poolId);
            const priceFromSdkInv = isFinite(poolPrice) && poolPrice > 0 ? 1 / poolPrice : NaN;
            const priceFromApiInv = Number(apiInfo.price) > 0 ? 1 / Number(apiInfo.price) : NaN;
            const priceInv = isFinite(priceFromSdkInv) ? priceFromSdkInv : priceFromApiInv;

            const aIsSol = apiInfo.mintA === WSOL_MINT;
            const bIsSol = apiInfo.mintB === WSOL_MINT;

            const amtA = apiInfo.mintAmountA ? Number(apiInfo.mintAmountA) : NaN;
            const amtB = apiInfo.mintAmountB ? Number(apiInfo.mintAmountB) : NaN;

            const solInPool = aIsSol ? amtA : bIsSol ? amtB : NaN;
            const tokenInPool = aIsSol ? amtB : bIsSol ? amtA : NaN;
            const otherMint = aIsSol ? apiInfo.mintB : bIsSol ? apiInfo.mintA : (apiInfo.mintA ?? "?");
            let burnPctStr = typeof apiInfo.burnPercent === "number" ? apiInfo.burnPercent.toFixed(2) + "%" : "?";
            if (typeof apiInfo.burnPercent !== "number") {
                //console.log(`burnPercent not available or not a number in API info for pool ${poolId}:`, apiInfo.burnPercent, "(using ?)");
            } else {
                //console.log(`burnPercent fetched from API for pool ${poolId}: ${burnPctStr}`);
            }

            v3Line =
                ` > PRICE: ${isFinite(priceInv) ? priceInv.toFixed(10) : "-"} ` +
                `LIQv3: [${isFinite(solInPool) ? solInPool.toString() : "?"} SOL / ` +
                `${isFinite(tokenInPool) ? tokenInPool.toString() : "?"}] ` +
                `(burnPercent=${burnPctStr})`;

            console.log(baseLine + v3Line);
            return;
        } else {
            //console.log("No API info for pool:", poolId, "- falling back to on-chain");
        }

        // DEVNET fallback: read vault balances on-chain using pool_keys
        const onChain = await readVaultBalancesOnChain(poolDbInfo);
        const inv = isFinite(poolPrice) && poolPrice > 0 ? (1 / poolPrice).toFixed(10) : "-";

        if (onChain) {
            //console.log("onChain result:", onChain);
            if (onChain.solInPool !== undefined || onChain.tokenInPool !== undefined) {
                //console.log("burnPercent not available in on-chain fallback (only via mainnet API); using ? (if no liquidity is burnt/locked, it would be 0%)");
                v3Line =
                    ` > PRICE: ${inv} ` +
                    `LIQv3: [` +
                    `${onChain.solInPool !== undefined ? onChain.solInPool : "?"} SOL / ` +
                    `${onChain.tokenInPool !== undefined ? onChain.tokenInPool : "?"}] ` +
                    `(burnPercent=?)`;
            } else {
                //console.log("onChain has no solInPool or tokenInPool defined");
                v3Line = ` > PRICE: ${inv} LIQv3: [no values computed]`;
            }
        } else {
            //console.log("onChain fallback returned null");
            v3Line = ` > PRICE: ${inv} LIQv3: [API/chain n/a]`;
        }

        // Add NFT check using Raydium SDK if available
        let lockStatus = "";
        if (raydium && adminKp) {
            const positionInfo = await fetchPoolPositionsInfo(poolId, raydium, adminKp);
            if (positionInfo.positionCount > 0) {
                lockStatus = positionInfo.positionCount == 0 ? "(no position)" : positionInfo.lockedPositionCount > 0 ? " LOCKED" : " unlocked";
            }
        } else {
            console.log("Raydium instance or adminKp not provided - skipping position info");
        }

        console.log(baseLine + v3Line + lockStatus);
    } catch (error) {
        console.error(`Error logging auction info for index ${index}:`, error);
    }
}