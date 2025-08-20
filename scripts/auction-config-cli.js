'use strict'

// Guided CLI to view and update on-chain Config via set_config
// - Shows current mainnet values
// - Lets user modify available config fields interactively
// - Supports dry-run (no transaction sent)

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const anchor = require('@coral-xyz/anchor')
const { Connection, PublicKey, Keypair } = require('@solana/web3.js')
const BN = require('bn.js')
let bs58 = null
try {
  bs58 = require('bs58')
} catch {}
let chalk = null
try {
  chalk = require('chalk')
  // Normalize for ESM default export shape
  if (chalk && chalk.default) chalk = chalk.default
  if (typeof chalk.cyan !== 'function') {
    chalk = {
      cyan: (s) => s,
      green: (s) => s,
      yellow: (s) => s,
      red: (s) => s,
      bold: (s) => s,
    }
  }
} catch {
  chalk = {
    cyan: (s) => s,
    green: (s) => s,
    yellow: (s) => s,
    red: (s) => s,
    bold: (s) => s,
  }
}

// Load .env if present
try {
  require('dotenv').config()
} catch {}

// Keep naming aligned with tests in tests/config.ts
const globalInfoSeed = 'global_info_seed'

function usage() {
  console.log(`\n${chalk.bold('MaxiAuction Config CLI')}\n`)
  console.log('Options:')
  console.log(
    '  --rpc <URL>                 RPC endpoint (default from env SOLANA_RPC_URL)',
  )
  console.log(
    '  --idl <PATH>                Path to IDL JSON (default: try mxm-api idl, then mxm-sol target idl)',
  )
  console.log(
    '  --keypair <PATH>            Path to admin keypair JSON (required to submit)',
  )
  console.log(
    '  --keypair-b58 <B58>         Base58-encoded private key (32-byte seed or 64-byte secret key)',
  )
  console.log(
    '  --fee1 <PUBKEY>             Set fee account 1 (50% if only fee1/fee2 provided)',
  )
  console.log(
    '  --fee2 <PUBKEY>             Set fee account 2 (50% if only fee1/fee2 provided)',
  )
  console.log(
    '  --fee1-share <INT>          Fee1 share in basis points (sum with fee2 must be 10000)',
  )
  console.log(
    '  --fee2-share <INT>          Fee2 share in basis points (sum with fee1 must be 10000)',
  )
  console.log('  --min-sol <SOL>             Override minTotalSol (in SOL)')
  console.log('  --admin <PUBKEY>            Override admin pubkey')
  console.log('  --dao <PUBKEY>              Override daoAccount')
  console.log(
    '  --start-price <SOL>         Override defaultStartPriceLamports (in SOL)',
  )
  console.log('  --supply <U64>              Override defaultTokenSupply')
  console.log('  --decimals <U8>             Override defaultTokenDecimals')
  console.log(
    '  --show-only                 Only display current config and exit',
  )
  console.log(
    "  --dry-run                   Don't send transaction; preview updates",
  )
  console.log(
    '  --yes                       Non-interactive: accept defaults and only update fields specified via env/flags',
  )
  console.log('\nEnvironment:')
  console.log('  SOLANA_RPC_URL              RPC endpoint')
  console.log('  ADMIN_KEYPAIR_PATH          Path to admin keypair JSON')
  console.log(
    '  ADMIN_KEYPAIR               Inline JSON array (64/32) for admin keypair',
  )
  console.log(
    '  ADMIN_KEYPAIR_B58           Base58-encoded private key (32/64 bytes)',
  )
  console.log('  MXM_IDL_PATH                Override IDL path')
  console.log('  FEE_ACCOUNT_1               Fee account 1')
  console.log('  FEE_ACCOUNT_2               Fee account 2')
  console.log(
    '  FEE1_SHARE                  Fee1 share (bp), default 5000 when FEE_ACCOUNT_1/2 set',
  )
  console.log(
    '  FEE2_SHARE                  Fee2 share (bp), default 5000 when FEE_ACCOUNT_1/2 set',
  )
  console.log('  MIN_TOTAL_SOL_SOL           Set minTotalSol (in SOL)')
  console.log('  ADMIN_PUBKEY                Override admin pubkey')
  console.log('  DAO_ACCOUNT                 Override daoAccount')
  console.log(
    '  DEFAULT_START_PRICE_SOL     Override defaultStartPriceLamports (in SOL)',
  )
  console.log('  DEFAULT_TOKEN_SUPPLY        Override defaultTokenSupply')
  console.log('  DEFAULT_TOKEN_DECIMALS      Override defaultTokenDecimals')
  console.log('\nExamples:')
  console.log('  node scripts/auction-config-cli.js --show-only')
  console.log(
    '  node scripts/auction-config-cli.js --dry-run --keypair ~/.config/solana/admin.json',
  )
  console.log(
    '  ADMIN_KEYPAIR_B58=<b58> SOLANA_RPC_URL=https://api.mainnet-beta.solana.com yarn config:cli -- --yes',
  )
  console.log('')
}

function parseArgs(argv) {
  const args = { flags: {}, positionals: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') {
      args.flags.help = true
      continue
    }
    if (a === '--show-only') {
      args.flags.showOnly = true
      continue
    }
    if (a === '--dry-run') {
      args.flags.dryRun = true
      continue
    }
    if (a === '--yes' || a === '-y') {
      args.flags.yes = true
      continue
    }
    if (a === '--rpc') {
      args.flags.rpc = argv[++i]
      continue
    }
    if (a === '--idl') {
      args.flags.idl = argv[++i]
      continue
    }
    if (a === '--keypair') {
      args.flags.keypair = argv[++i]
      continue
    }
    if (a === '--keypair-b58') {
      args.flags.keypairB58 = argv[++i]
      continue
    }
    if (a === '--fee1') {
      args.flags.fee1 = argv[++i]
      continue
    }
    if (a === '--fee2') {
      args.flags.fee2 = argv[++i]
      continue
    }
    if (a === '--fee1-share') {
      args.flags.fee1Share = argv[++i]
      continue
    }
    if (a === '--fee2-share') {
      args.flags.fee2Share = argv[++i]
      continue
    }
    if (a === '--min-sol') {
      args.flags.minSol = argv[++i]
      continue
    }
    if (a === '--admin') {
      args.flags.admin = argv[++i]
      continue
    }
    if (a === '--dao') {
      args.flags.dao = argv[++i]
      continue
    }
    if (a === '--start-price') {
      args.flags.startPrice = argv[++i]
      continue
    }
    if (a === '--supply') {
      args.flags.supply = argv[++i]
      continue
    }
    if (a === '--decimals') {
      args.flags.decimals = argv[++i]
      continue
    }
    args.positionals.push(a)
  }
  return args
}

function loadJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(content)
}

function findDefaultIdlPath() {
  const apiIdl = path.resolve(
    __dirname,
    '../..',
    'mxm-api/src/contract/idl/maxi_auction.json',
  )
  const solIdl = path.resolve(__dirname, '..', 'target/idl/maxi_auction.json')
  if (process.env.MXM_IDL_PATH && fs.existsSync(process.env.MXM_IDL_PATH))
    return process.env.MXM_IDL_PATH
  // Prefer API IDL for mainnet correctness
  if (fs.existsSync(apiIdl)) return apiIdl
  if (fs.existsSync(solIdl)) return solIdl
  throw new Error('IDL not found. Provide --idl or set MXM_IDL_PATH.')
}

function findProgramIdFromBestSource(primaryIdl, primaryIdlPath) {
  // Allow explicit override first
  if (process.env.PROGRAM_ID) return new PublicKey(process.env.PROGRAM_ID)
  // Try to read from API IDL if present
  try {
    const apiIdlPath = path.resolve(
      __dirname,
      '../..',
      'mxm-api/src/contract/idl/maxi_auction.json',
    )
    if (fs.existsSync(apiIdlPath)) {
      const apiIdl = loadJson(apiIdlPath)
      if (apiIdl && apiIdl.address) return new PublicKey(apiIdl.address)
    }
  } catch {}
  // Fallback to the selected IDL's address
  if (primaryIdl && primaryIdl.address) return new PublicKey(primaryIdl.address)
  throw new Error(
    `Unable to determine program ID from ${primaryIdlPath}. Provide --program-id or set PROGRAM_ID.`,
  )
}

function ensureIdlAccountsHaveType(idl) {
  if (!idl.accounts) return idl
  const patched = {
    ...idl,
    accounts: idl.accounts.map((acc) => {
      if (acc && acc.type) return acc
      return { ...acc, type: { defined: acc.name } }
    }),
  }
  return patched
}

function hasInstruction(idl, instrName) {
  const list = idl && Array.isArray(idl.instructions) ? idl.instructions : []
  return list.some((ix) => ix && ix.name === instrName)
}

function mergeIdlAddInstruction(baseIdl, altIdl, instrName) {
  if (hasInstruction(baseIdl, instrName)) return baseIdl
  const altList =
    altIdl && Array.isArray(altIdl.instructions) ? altIdl.instructions : []
  const found = altList.find((ix) => ix && ix.name === instrName)
  if (!found) return baseIdl
  const merged = {
    ...baseIdl,
    instructions: [...(baseIdl.instructions || []), found],
  }
  return merged
}

function toBN(value) {
  if (BN.isBN(value)) return value
  if (typeof value === 'number') return new BN(value)
  if (typeof value === 'string') return new BN(value)
  if (value && typeof value.toString === 'function')
    return new BN(value.toString())
  throw new Error(`Cannot convert to BN: ${value}`)
}

function lamportsToSol(lamports) {
  const bn = toBN(lamports)
  const L = new BN(1_000_000_000)
  const whole = bn.div(L).toString()
  const frac = bn.mod(L).toString().padStart(9, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function solToLamportsBn(inputStr) {
  const s = String(inputStr).trim()
  if (!s) throw new Error('Empty SOL amount')
  const [wholeStr, fracStrRaw] = s.split('.')
  const whole = new BN(wholeStr || '0')
  const fracStr = (fracStrRaw || '').slice(0, 9).padEnd(9, '0')
  const frac = new BN(fracStr || '0')
  return whole.mul(new BN(1_000_000_000)).add(frac)
}

function formatPubkey(v) {
  try {
    return new PublicKey(v).toBase58()
  } catch {
    return String(v)
  }
}

function ensurePubkey(str) {
  return new PublicKey(str)
}

function buildProvider(connection, keypairOpt) {
  const wallet = keypairOpt
    ? new anchor.Wallet(keypairOpt)
    : new anchor.Wallet(Keypair.generate())
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  })
  anchor.setProvider(provider)
  return provider
}

function resolveKeypairFromEnvOrPath(pathFlag, b58Flag) {
  const fp =
    pathFlag || process.env.ADMIN_KEYPAIR_PATH || process.env.ANCHOR_WALLET
  if (fp && fs.existsSync(fp)) {
    const arr = JSON.parse(fs.readFileSync(fp, 'utf8'))
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  if (process.env.ADMIN_KEYPAIR) {
    const arr = JSON.parse(process.env.ADMIN_KEYPAIR)
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  const b58Str = b58Flag || process.env.ADMIN_KEYPAIR_B58
  if (b58Str) {
    if (!bs58)
      throw new Error(
        'bs58 module not available. Install it or use JSON keypair.',
      )
    const bytes = bs58.decode(b58Str.trim())
    if (bytes.length === 64) {
      return Keypair.fromSecretKey(Uint8Array.from(bytes))
    }
    if (bytes.length === 32) {
      return Keypair.fromSeed(Uint8Array.from(bytes))
    }
    throw new Error(
      `Invalid base58 key length ${bytes.length}. Expected 32 or 64 bytes.`,
    )
  }
  return null
}

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)))
}

function printHeader(idlAddress, rpcUrl) {
  console.log(`${chalk.cyan('Program ID:')} ${idlAddress}`)
  console.log(`${chalk.cyan('RPC:')} ${rpcUrl}`)
}

function printConfig(config) {
  const cfg = config
  console.log(`\n${chalk.bold('Current Config (on-chain)')}`)
  const lines = []
  const hasFeeAccounts = Array.isArray(cfg.feeAccounts)
  lines.push(['admin', formatPubkey(cfg.admin)])
  if (cfg.defaultTokenSupply !== undefined)
    lines.push(['defaultTokenSupply', String(cfg.defaultTokenSupply)])
  if (cfg.defaultTokenDecimals !== undefined)
    lines.push(['defaultTokenDecimals', String(cfg.defaultTokenDecimals)])
  if (cfg.defaultStartPriceLamports !== undefined)
    lines.push([
      'defaultStartPriceLamports',
      `${cfg.defaultStartPriceLamports.toString()} (${lamportsToSol(
        cfg.defaultStartPriceLamports,
      )} SOL)`,
    ])
  if (hasFeeAccounts) {
    const fa = cfg.feeAccounts.map(
      (fa, i) =>
        `${i + 1}. ${formatPubkey(fa.pubkey)} • share=${fa.share.toString()}`,
    )
    lines.push(['feeAccounts', fa.join('\n   ') || '[]'])
  } else if (cfg.feeAccount) {
    lines.push(['feeAccount', formatPubkey(cfg.feeAccount)])
  }
  if (cfg.daoAccount !== undefined)
    lines.push(['daoAccount', formatPubkey(cfg.daoAccount)])
  if (cfg.minTotalSol !== undefined)
    lines.push([
      'minTotalSol',
      `${cfg.minTotalSol.toString()} (${lamportsToSol(cfg.minTotalSol)} SOL)`,
    ])
  if (cfg.refBidFeePercShare !== undefined)
    lines.push(['refBidFeePercShare', cfg.refBidFeePercShare.toString()])
  if (cfg.minBidSize !== undefined)
    lines.push(['minBidSize', cfg.minBidSize.toString()])

  const pad = Math.max(...lines.map(([k]) => k.length)) + 2
  for (const [k, v] of lines) {
    console.log(`${chalk.green(k.padEnd(pad))}${v}`)
  }
}

function applyOverridesFromFlagsEnv(currentCfg, flags) {
  const next = { ...currentCfg }
  const env = process.env

  function setIf(val, setter) {
    if (val !== undefined && val !== null && val !== '') setter(val)
  }

  setIf(flags.admin || env.ADMIN_PUBKEY, (v) => {
    next.admin = ensurePubkey(v)
  })
  setIf(flags.dao || env.DAO_ACCOUNT, (v) => {
    next.daoAccount = ensurePubkey(v)
  })

  // Start price in SOL
  setIf(flags.startPrice || env.DEFAULT_START_PRICE_SOL, (v) => {
    next.defaultStartPriceLamports = solToLamportsBn(v)
  })

  // Token supply/decimals
  setIf(flags.supply || env.DEFAULT_TOKEN_SUPPLY, (v) => {
    next.defaultTokenSupply = toBN(v)
  })
  setIf(flags.decimals || env.DEFAULT_TOKEN_DECIMALS, (v) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0 || n > 18)
      throw new Error('Invalid decimals')
    next.defaultTokenDecimals = n
  })

  // Min total SOL (SOL units)
  setIf(flags.minSol || env.MIN_TOTAL_SOL_SOL, (v) => {
    next.minTotalSol = solToLamportsBn(v)
  })

  // Fee accounts; prefer vector if present
  const fee1 = flags.fee1 || env.FEE_ACCOUNT_1
  const fee2 = flags.fee2 || env.FEE_ACCOUNT_2
  const fee1Share = flags.fee1Share || env.FEE1_SHARE
  const fee2Share = flags.fee2Share || env.FEE2_SHARE
  if (fee1 && fee2) {
    const s1 = fee1Share !== undefined ? toBN(fee1Share) : new BN(5000)
    const s2 = fee2Share !== undefined ? toBN(fee2Share) : new BN(5000)
    const sum = s1.add(s2)
    if (!sum.eq(new BN(10000))) {
      throw new Error(`fee shares must sum to 10000, got ${sum.toString()}`)
    }
    next.feeAccounts = [
      { pubkey: ensurePubkey(fee1), share: s1 },
      { pubkey: ensurePubkey(fee2), share: s2 },
    ]
    delete next.feeAccount // prefer vector shape
  }

  return next
}

function printGlobalInfoExtras(globalInfo) {
  // Show authority source for awareness (deployer if present, else admin from config)
  const authority = globalInfo.deployer
    ? formatPubkey(globalInfo.deployer)
    : globalInfo.config?.admin
    ? formatPubkey(globalInfo.config.admin)
    : 'N/A'
  const auctionsNum =
    globalInfo.auctionsNum !== undefined
      ? globalInfo.auctionsNum.toString()
      : globalInfo.auctions_num !== undefined
      ? globalInfo.auctions_num.toString()
      : 'N/A'
  console.log(`\n${chalk.bold('GlobalInfo')}`)
  const lines = []
  lines.push(['authority', authority])
  lines.push(['auctionsNum', auctionsNum])
  const pad = Math.max(...lines.map(([k]) => k.length)) + 2
  for (const [k, v] of lines) {
    console.log(`${chalk.green(k.padEnd(pad))}${v}`)
  }
}

async function promptModifyConfig(currentCfg, yesMode) {
  if (yesMode) return currentCfg
  const rl = createRl()
  let newCfg = { ...currentCfg }

  async function editFeeVector() {
    // Sub-menu for feeAccounts vector
    while (true) {
      console.log('\nEdit feeAccounts:')
      console.log('  1) Set two accounts at 50/50')
      console.log(
        '  2) Enter accounts list as <pubkey>:<share> lines (sum=10000)',
      )
      console.log('  0) Back')
      const choice = (await ask(rl, 'Select: ')).trim()
      if (choice === '0') return
      if (choice === '1') {
        const a1 = (await ask(rl, '  Fee account 1 pubkey: ')).trim()
        const a2 = (await ask(rl, '  Fee account 2 pubkey: ')).trim()
        newCfg.feeAccounts = [
          { pubkey: ensurePubkey(a1), share: new BN(5000) },
          { pubkey: ensurePubkey(a2), share: new BN(5000) },
        ]
        delete newCfg.feeAccount
        console.log('  Set to 50/50.')
        return
      }
      if (choice === '2') {
        console.log(
          '  Enter fee accounts lines. Empty line to finish. Total share must = 10000.',
        )
        const list = []
        while (true) {
          const line = (
            await ask(rl, `    account ${list.length + 1}: `)
          ).trim()
          if (!line) break
          const [pk, shareStr] = line.split(':')
          const share = toBN(shareStr)
          list.push({ pubkey: ensurePubkey(pk), share })
        }
        const sum = list.reduce((acc, it) => acc.add(toBN(it.share)), new BN(0))
        if (!sum.eq(new BN(10000))) {
          console.log(
            `  Invalid total: ${sum.toString()} (must be 10000). Try again.`,
          )
          continue
        }
        newCfg.feeAccounts = list
        delete newCfg.feeAccount
        return
      }
    }
  }

  async function editMenu() {
    while (true) {
      console.log('\nSelect a field to edit (0 to finish):')
      const menu = []
      let idx = 1
      menu.push({
        k: String(idx++),
        label: `admin (${formatPubkey(newCfg.admin)})`,
        fn: async () => {
          const v = (await ask(rl, 'New admin pubkey: ')).trim()
          if (v) newCfg.admin = ensurePubkey(v)
        },
      })
      if (newCfg.defaultStartPriceLamports !== undefined) {
        menu.push({
          k: String(idx++),
          label: `defaultStartPriceLamports (${lamportsToSol(
            newCfg.defaultStartPriceLamports,
          )} SOL)`,
          fn: async () => {
            const v = (await ask(rl, 'New defaultStartPrice (SOL): ')).trim()
            if (v) newCfg.defaultStartPriceLamports = solToLamportsBn(v)
          },
        })
      }
      if (newCfg.defaultTokenSupply !== undefined) {
        menu.push({
          k: String(idx++),
          label: `defaultTokenSupply (${newCfg.defaultTokenSupply})`,
          fn: async () => {
            const v = (await ask(rl, 'New defaultTokenSupply: ')).trim()
            if (v) newCfg.defaultTokenSupply = toBN(v)
          },
        })
      }
      if (newCfg.defaultTokenDecimals !== undefined) {
        menu.push({
          k: String(idx++),
          label: `defaultTokenDecimals (${newCfg.defaultTokenDecimals})`,
          fn: async () => {
            const v = (
              await ask(rl, 'New defaultTokenDecimals (0-18): ')
            ).trim()
            if (v) {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 0 || n > 18)
                throw new Error('Invalid decimals')
              newCfg.defaultTokenDecimals = n
            }
          },
        })
      }
      if (Array.isArray(newCfg.feeAccounts)) {
        menu.push({
          k: String(idx++),
          label: `feeAccounts (${newCfg.feeAccounts.length} entries)`,
          fn: async () => {
            await editFeeVector()
          },
        })
      } else if (newCfg.feeAccount) {
        menu.push({
          k: String(idx++),
          label: `feeAccount (${formatPubkey(newCfg.feeAccount)})`,
          fn: async () => {
            const v = (await ask(rl, 'New feeAccount pubkey: ')).trim()
            if (v) newCfg.feeAccount = ensurePubkey(v)
          },
        })
      }
      if (newCfg.daoAccount !== undefined) {
        menu.push({
          k: String(idx++),
          label: `daoAccount (${formatPubkey(newCfg.daoAccount)})`,
          fn: async () => {
            const v = (await ask(rl, 'New daoAccount pubkey: ')).trim()
            if (v) newCfg.daoAccount = ensurePubkey(v)
          },
        })
      }
      if (newCfg.minTotalSol !== undefined) {
        menu.push({
          k: String(idx++),
          label: `minTotalSol (${lamportsToSol(newCfg.minTotalSol)} SOL)`,
          fn: async () => {
            const v = (await ask(rl, 'New minTotalSol (SOL): ')).trim()
            if (v) newCfg.minTotalSol = solToLamportsBn(v)
          },
        })
      }
      if (newCfg.refBidFeePercShare !== undefined) {
        menu.push({
          k: String(idx++),
          label: `refBidFeePercShare (${newCfg.refBidFeePercShare.toString()})`,
          fn: async () => {
            const v = (
              await ask(rl, 'New refBidFeePercShare (0-1000): ')
            ).trim()
            if (v) {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 0 || n > 1000)
                throw new Error('Invalid refBidFeePercShare')
              newCfg.refBidFeePercShare = new BN(n)
            }
          },
        })
      }
      if (newCfg.minBidSize !== undefined) {
        menu.push({
          k: String(idx++),
          label: `minBidSize (${newCfg.minBidSize.toString()})`,
          fn: async () => {
            const v = (await ask(rl, 'New minBidSize: ')).trim()
            if (v) newCfg.minBidSize = toBN(v)
          },
        })
      }

      // Print
      for (const opt of menu) console.log(`  ${opt.k}) ${opt.label}`)
      console.log('  0) Done')
      const sel = (await ask(rl, 'Select: ')).trim()
      if (sel === '0') return
      const opt = menu.find((o) => o.k === sel)
      if (opt) {
        try {
          await opt.fn()
        } catch (e) {
          console.log(chalk.red(String(e.message || e)))
        }
      }
    }
  }

  // Initial print and menu loop
  printConfig(newCfg)
  await editMenu()
  rl.close()
  return newCfg
}

function normalizeConfigForIdlShape(cfg) {
  // Ensure u64 fields are BN and keys exist as expected by current IDL
  const out = { ...cfg }
  if (out.defaultTokenSupply !== undefined)
    out.defaultTokenSupply = toBN(out.defaultTokenSupply)
  if (out.defaultStartPriceLamports !== undefined)
    out.defaultStartPriceLamports = toBN(out.defaultStartPriceLamports)
  if (out.minTotalSol !== undefined) out.minTotalSol = toBN(out.minTotalSol)
  if (out.refBidFeePercShare !== undefined)
    out.refBidFeePercShare = toBN(out.refBidFeePercShare)
  if (out.minBidSize !== undefined) out.minBidSize = toBN(out.minBidSize)
  if (Array.isArray(out.feeAccounts)) {
    out.feeAccounts = out.feeAccounts.map((it) => ({
      pubkey: new PublicKey(it.pubkey),
      share: toBN(it.share),
    }))
  }
  if (out.feeAccount) out.feeAccount = new PublicKey(out.feeAccount)
  out.admin = new PublicKey(out.admin)
  if (out.daoAccount) out.daoAccount = new PublicKey(out.daoAccount)
  return out
}

async function main() {
  const { flags } = parseArgs(process.argv)
  if (flags.help) {
    usage()
    return
  }

  const idlPath = flags.idl || findDefaultIdlPath()
  const rawIdl = loadJson(idlPath)
  const programIdPubkey = flags.programId
    ? new PublicKey(flags.programId)
    : findProgramIdFromBestSource(rawIdl, idlPath)
  // If primary IDL lacks set_config, merge it from the other IDL (API vs target)
  let idlCore = ensureIdlAccountsHaveType(rawIdl)
  try {
    const apiPath = path.resolve(
      __dirname,
      '../..',
      'mxm-api/src/contract/idl/maxi_auction.json',
    )
    const solPath = path.resolve(
      __dirname,
      '..',
      'target/idl/maxi_auction.json',
    )
    const altPath =
      idlPath.includes('/mxm-api/') && fs.existsSync(solPath)
        ? solPath
        : fs.existsSync(apiPath)
        ? apiPath
        : null
    if (altPath) {
      const alt = ensureIdlAccountsHaveType(loadJson(altPath))
      idlCore = mergeIdlAddInstruction(idlCore, alt, 'set_config')
    }
  } catch {}
  const idl = { ...idlCore, address: programIdPubkey.toBase58() }
  // Debug: validate IDL shapes expected by @coral-xyz/anchor 0.30
  const accNames = (idl.accounts || []).map((a) => a && a.name)
  const typeNames = (idl.types || []).map((t) => t && t.name)
  if (!accNames.includes('GlobalInfo')) {
    console.error(
      chalk.red(
        'IDL missing GlobalInfo account. Provide a compatible IDL via --idl or MXM_IDL_PATH.',
      ),
    )
    process.exit(1)
  }
  const missingType = accNames.find((n) => !(typeNames || []).includes(n))
  if (missingType) {
    console.error(
      chalk.red(`IDL missing type definition for account ${missingType}.`),
    )
    process.exit(1)
  }

  const rpcUrl =
    flags.rpc ||
    process.env.SOLANA_RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    'https://api.mainnet-beta.solana.com'
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })
  const adminKp = resolveKeypairFromEnvOrPath(flags.keypair, flags.keypairB58)
  const provider = buildProvider(connection, adminKp || null)
  const program = new anchor.Program(idl, provider)

  printHeader(program.programId.toBase58(), rpcUrl)
  if (adminKp) {
    console.log(
      `${chalk.green('Admin keypair loaded')}: ${adminKp.publicKey.toBase58()}`,
    )
  } else {
    console.log(
      `${chalk.yellow(
        'No admin keypair loaded',
      )} (dry-run and show-only still work)`,
    )
  }

  const [globalInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(globalInfoSeed)],
    program.programId,
  )

  // Fetch GlobalInfo -> config
  let globalInfo
  try {
    globalInfo = await program.account.globalInfo.fetch(globalInfoPda)
  } catch (e) {
    console.error(
      chalk.red(`Failed to fetch GlobalInfo at ${globalInfoPda.toBase58()}`),
    )
    console.error(e)
    process.exit(1)
  }

  let currentCfg = globalInfo.config
  printConfig(currentCfg)
  printGlobalInfoExtras(globalInfo)

  if (flags.showOnly) {
    console.log(`\n${chalk.yellow('Show-only mode: no changes made.')}`)
    return
  }

  // Warn if no admin key when not dry-run
  if (!flags.dryRun && !adminKp) {
    console.log(
      `\n${chalk.red(
        'Admin keypair required to submit. Provide --keypair/--keypair-b58 or ADMIN_KEYPAIR_PATH / ADMIN_KEYPAIR / ADMIN_KEYPAIR_B58.',
      )}`,
    )
    process.exit(2)
  }

  // Optional sanity: ensure caller matches expected authority (deployer if present, else config.admin)
  if (adminKp) {
    const expectedAuthority = globalInfo.deployer
      ? new PublicKey(globalInfo.deployer).toBase58()
      : new PublicKey(currentCfg.admin).toBase58()
    const callerPk = adminKp.publicKey.toBase58()
    if (expectedAuthority !== callerPk) {
      console.log(
        `${chalk.yellow(
          'Warning',
        )}: caller ${callerPk} != expected authority ${expectedAuthority}. On-chain authorization may fail.`,
      )
    }
  }

  // Apply overrides from flags/env first (supports --yes non-interactive updates)
  currentCfg = applyOverridesFromFlagsEnv(currentCfg, flags)

  // Interactive modification (skipped in --yes mode)
  const updatedCfg = await promptModifyConfig(currentCfg, !!flags.yes)
  const normalizedCfg = normalizeConfigForIdlShape(updatedCfg)

  console.log(`\n${chalk.bold('Proposed Config Update')}`)
  printConfig(normalizedCfg)

  if (flags.dryRun) {
    console.log(`\n${chalk.yellow('Dry-run: no transaction sent.')}`)
    return
  }

  // Confirm
  if (!flags.yes) {
    const rl = createRl()
    const conf = (
      await ask(
        rl,
        `${chalk.bold(
          'Proceed with set_config on mainnet?',
        )} (type YES to confirm): `,
      )
    ).trim()
    rl.close()
    if (conf !== 'YES') {
      console.log('Aborted.')
      return
    }
  }

  // Submit update: prefer set_config; if chain rejects (no ix), fall back to initialize
  try {
    const supportsSetConfig = (idl.instructions || []).some(
      (ix) => ix && ix.name === 'set_config',
    )
    let txSig
    if (supportsSetConfig) {
      try {
        txSig = await program.methods
          .setConfig(normalizedCfg)
          .accounts({
            caller: provider.wallet.publicKey,
            globalInfo: globalInfoPda,
          })
          .rpc()
        console.log(
          `\n${chalk.green('Transaction (set_config) submitted:')} ${txSig}`,
        )
      } catch (err) {
        const msg = String(err?.message || '')
        const logs = Array.isArray(err?.logs) ? err.logs.join(' ') : ''
        const looksLikeFallbackMissing =
          msg.includes('Fallback') ||
          msg.includes('101') ||
          logs.includes('Fallback')
        if (!looksLikeFallbackMissing) throw err
        txSig = await program.methods
          .initialize(normalizedCfg)
          .accounts({ signer: provider.wallet.publicKey })
          .rpc()
        console.log(
          `\n${chalk.green(
            'Transaction (initialize, fallback) submitted:',
          )} ${txSig}`,
        )
      }
    } else {
      txSig = await program.methods
        .initialize(normalizedCfg)
        .accounts({ signer: provider.wallet.publicKey })
        .rpc()
      console.log(
        `\n${chalk.green('Transaction (initialize) submitted:')} ${txSig}`,
      )
    }
  } catch (e) {
    console.error(chalk.red('Failed to submit config update transaction.'))
    console.error(e)
    process.exit(3)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
