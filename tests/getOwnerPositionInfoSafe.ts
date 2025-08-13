import { PublicKey, Connection } from '@solana/web3.js'
import { POOL_LOCK_ID_SEED, PositionInfoLayout, LockClPositionLayoutV2 } from '@raydium-io/raydium-sdk-v2'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { findProgramAddress } from '@raydium-io/raydium-sdk-v2'
import { POSITION_SEED } from '@raydium-io/raydium-sdk-v2'

const BATCH_SIZE = 100

export async function getOwnerPositionsInfo_Safe(opts: {
    connection: Connection
    owner: PublicKey
    programId: string | PublicKey
    poolId: PublicKey | null
}) {
    const { connection, owner, poolId } = opts
    const programIdPk = typeof opts.programId === 'string' ? new PublicKey(opts.programId) : opts.programId

    // Get all token accounts for the owner
    const tokenAccounts = await connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })

    // Filter for potential position NFTs (amount === 1)
    const balanceMints = tokenAccounts.value
        .map((ta) => ta.account.data)
        .filter((data) => {
            const amount = data.slice(64, 72) // Offset for amount in SPL token account layout
            return Buffer.from(amount).readBigUInt64LE(0) === BigInt(1)
        })
        .map((data) => {
            const mint = data.slice(0, 32) // Offset for mint
            return new PublicKey(mint)
        })

    if (balanceMints.length === 0) {
        return []
    }

    // Derive position keys
    const allPositionKeys = balanceMints.map((mint) => getPdaPersonalPositionAddress(programIdPk, mint).publicKey)

    const positions = []

    // Batch fetch position accounts
    for (let i = 0; i < allPositionKeys.length; i += BATCH_SIZE) {
        const batchKeys = allPositionKeys.slice(i, i + BATCH_SIZE)
        const accountInfos = await connection.getMultipleAccountsInfo(batchKeys)
        for (const positionRes of accountInfos) {
            if (!positionRes) continue
            const position = PositionInfoLayout.decode(positionRes.data)
            if (poolId == null || position.poolId.equals(poolId)) {
                positions.push(position)
            }
        }
    }

    return positions
}

export async function getOwnerLockedPositionInfo_Safe(opts: {
    connection: Connection
    owner: PublicKey
    programId: string | PublicKey
    poolId: PublicKey | null
}) {
    const { connection, owner, poolId } = opts
    const programIdPk = typeof opts.programId === 'string' ? new PublicKey(opts.programId) : opts.programId

    // Get all token accounts for the owner
    const tokenAccounts = await connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })

    // Filter for potential position NFTs (amount === 1)
    const balanceMints = tokenAccounts.value
        .map((ta) => ta.account.data)
        .filter((data) => {
            const amount = data.slice(64, 72) // Offset for amount in SPL token account layout
            return Buffer.from(amount).readBigUInt64LE(0) === BigInt(1)
        })
        .map((data) => {
            const mint = data.slice(0, 32) // Offset for mint
            return new PublicKey(mint)
        })

    if (balanceMints.length === 0) {
        return []
    }

    // Derive lock position keys
    const allLockPositionKeys = balanceMints.map((mint) => getPdaLockClPositionIdV2(programIdPk, mint).publicKey)

    const lockPositions: ReturnType<typeof LockClPositionLayoutV2.decode>[] = []
    const lockIndices: number[] = [] // To keep track of original indices if needed, but not necessary for pairing

    // Batch fetch lock position accounts
    for (let i = 0; i < allLockPositionKeys.length; i += BATCH_SIZE) {
        const batchKeys = allLockPositionKeys.slice(i, i + BATCH_SIZE)
        const accountInfos = await connection.getMultipleAccountsInfo(batchKeys)
        accountInfos.forEach((positionRes, batchIdx) => {
            if (!positionRes) {
                return
            }
            //try {
                const lockInfo = LockClPositionLayoutV2.decode(positionRes.data)
                lockPositions.push(lockInfo)
                lockIndices.push(i + batchIdx) // Optional
            // } catch (error) {
            //     //console.error(`[DEBUG] Failed to decode lock position at key: ${batchKeys[batchIdx].toBase58()}. Error:`, error)
            // }
        })
    }

    if (lockPositions.length === 0) {
        return []
    }

    // Get position IDs
    const positionKeys = lockPositions.map((p) => p.positionId)

    const positions: ReturnType<typeof PositionInfoLayout.decode>[] = []

    // Batch fetch position accounts
    for (let i = 0; i < positionKeys.length; i += BATCH_SIZE) {
        const batchKeys = positionKeys.slice(i, i + BATCH_SIZE)
        const accountInfos = await connection.getMultipleAccountsInfo(batchKeys)
        accountInfos.forEach((positionRes) => {
            if (!positionRes) return
            const position = PositionInfoLayout.decode(positionRes.data)
            if (poolId == null || position.poolId.equals(poolId)) {
                positions.push(position)
            }
        })
    }

    // Pair them (assuming order preserved and lengths match; if a position is missing, it would be skipped, but for safety, lengths should match)
    return lockPositions.filter(p => p.poolId.equals(poolId) || poolId == null).map((lockInfo, idx) => ({
        position: positions[idx],
        lockInfo
    }))
}

function getPdaPersonalPositionAddress(
    programId: PublicKey,
    nftMint: PublicKey,
): {
    publicKey: PublicKey;
    nonce: number;
} {
    return findProgramAddress([POSITION_SEED, nftMint.toBuffer()], programId);
}

export function getPdaLockClPositionIdV2(
    programId: PublicKey,
    lockNftMint: PublicKey,
): {
    publicKey: PublicKey;
    nonce: number;
} {
    return findProgramAddress([POOL_LOCK_ID_SEED, lockNftMint.toBuffer()], programId);
}
