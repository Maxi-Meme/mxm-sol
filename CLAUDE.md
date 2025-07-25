# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **mxm-sol** component of Maxi.meme - a Solana-based decentralized Dutch auction platform. The smart contract implements Dutch auction mechanics with descending price mechanisms using the Anchor framework.

## Essential Development Commands

### Setup Commands
```bash
# Install required Solana CLI version
sh -c "$(curl -sSfL https://release.anza.xyz/v2.0.20/install)"

# Install required Rust version
rustup install 1.85.0 && rustup default 1.85.0

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# Setup environment
npm install
```

### Build and Deploy Commands
```bash
# Lint and format
npm run lint                    # Check Rust formatting with Prettier
npm run lint:fix               # Fix formatting issues

# Build contract (requires specific Rust toolchain)
npm run anchor:build           # RUSTUP_TOOLCHAIN='nightly-2024-11-19' anchor build
npm run anchor:deploy          # Deploy to configured network

# Test commands
npm run anchor:test            # Run tests (skip build/deploy)
npm run anchor:test-deploy     # Deploy then test
npm run test:single -- "test name"  # Run specific test by name
```

### Local Development Setup
```bash
# Start local validator with MPL programs
./mpl.sh                       # Interactive script to start validator

# Manual validator setup
solana config set --url http://127.0.0.1:8899/
solana config set --keypair ./id.json
solana airdrop 10
```

### Program Management
```bash
# Display program ID and private key
npm run display_id_privkey

# Create new program ID (when data structures change)
solana-keygen new -o target/deploy/maxi_auction-keypair.json --force
anchor keys sync               # Sync Anchor.toml & lib.rs with new ID
```

## Architecture Overview

### Smart Contract Structure

**Main Program Entry Point**: `programs/maxi-auction/src/lib.rs`
- Program ID: `Fv2XnLMdupyH9DkQ9Yko8vdWS57fJXQtBFhJoMc1uVLn` (devnet)
- Program ID: `9gfCVyYBrYEA5oFqXNMRxZNGKsEPCFkRsHFkMDYd2CHF` (localnet)

**Core Modules**:
- `account.rs`: Account structures (GlobalInfo, Auction, Bids)
- `states.rs`: Data structures (Config, Bid, AuctionStatus enum)
- `instructions/`: Individual instruction handlers
  - `initialize.rs`: Initialize auction system
  - `create_auction.rs`: Create new auctions
  - `place_bid.rs`: Handle bid placement
  - `cancel_bid.rs`: Cancel existing bids
  - `claim.rs`: Claim auction rewards
  - `withdraw_sol.rs` / `withdraw_tokens.rs`: Admin withdrawal functions
  - `finalize.rs`: Finalize completed auctions

### Key Account Types

**GlobalInfo**: System-wide configuration and auction counter
- `deployer`: Admin public key
- `auctions_num`: Total number of auctions created
- `config`: System configuration (fees, token defaults, etc.)

**Auction**: Individual auction data
- Dutch auction mechanics with descending price
- Token creation integrated with Metaplex
- Time-based auction periods (configurable duration)
- Status tracking (Pending, Live, Succeeded, Failed, Finalized)

**Bids**: Bid storage for each auction
- Dynamic vector of bids per auction
- Tracks bidder, amount, timestamp, claim status

### Program Seeds and PDAs

Key seeds defined in `tests/config.ts`:
- `globalInfoSeed = "global_info_seed"`
- `auctionSolSeed = "auction_sol_seed"`
- `auctionDataSeed = "auction_data_seed"`
- `auctionBidsSeed = "bids_seed"`

## Testing Configuration

**Test Framework**: Mocha with TypeScript via `ts-mocha`
**Test Location**: `tests/` directory with comprehensive test suites

### Key Test Files
- `maxi-auction.ts`: Main test suite with all auction functionality
- `pools.spec.ts`: Pool-related tests for liquidity integration
- `config.ts`: Test configuration constants

### Test Configuration Constants
- Token supply: 35,023,465 * 10^6 (for 69M total with overmint)
- Start price: 100 lamports (0.000000100 SOL)
- Distribution: 96.31% to bidders
- Minimum total SOL: 0.0008 SOL for auction success
- Token decimals: 6 (required for devnet liquidity compatibility)

### Test Categories (from README examples)
- **Base**: Auction creation, bidding, cancellation
- **Claims**: Token claiming after auction completion
- **Admin**: SOL/token withdrawal, pool management
- **Stress**: High-volume bidding tests
- **Testdata**: Dynamic test data generation with themes

## Development Environment

### Required Versions
- **Solana CLI**: 2.0.20
- **Rust**: 1.85.0 with nightly-2024-11-19 toolchain
- **Anchor**: 0.30.1
- **Node.js**: Compatible with package.json dependencies

### Network Configuration
**Anchor.toml** defines clusters:
- `localnet`: Local development (cluster = "Localnet")
- `devnet`: Devnet deployment
- Test validator configured with Helius RPC forking

### MPL Program Dependencies
Contract requires Metaplex programs:
- `mpl-token-metadata.so`: Token metadata program
- `mpl-bubblegum.so`: Compressed NFTs
- `mpl-core.so`: Core Metaplex functionality

## Common Development Patterns

### Error Handling
- Custom error types in `errors.rs`
- Anchor's built-in error handling for account validation
- Program ID mismatch validation critical for deployment

### Build Issues and Solutions
1. **proc-macro2 version conflicts**: `cargo update -p proc-macro2 --precise 1.0.94`
2. **Lock file version errors**: Use `anchor build -- -- -Znext-lockfile-bump`
3. **ELF deployment errors**: Copy from `target/sbf-solana-solana/release/` to `target/deploy/`

### Testing Patterns
- Use environment variables for RPC configuration
- 1,000,000ms timeout for blockchain operations
- Skip build/deploy flags for faster test iterations
- Grep-based test filtering for development

## Integration Points

### External Dependencies
- **Raydium SDK**: For automated liquidity pool creation post-auction
- **Metaplex**: Token creation and metadata management
- **SPL Token**: Standard token operations

### Account Management
- PDA-based account derivation for predictable addresses
- Cross-program invocations for token operations
- Rent-exempt account requirements

## Important Development Rules

- Never modify core auction logic without comprehensive testing
- Always sync program IDs between `lib.rs` and `Anchor.toml` after deployment
- Use the specific Rust toolchain (`nightly-2024-11-19`) for consistent builds
- Test thoroughly on localnet before devnet deployment (costs ~3.2 SOL)
- Preserve test ledger data when possible to avoid re-setup time

## Security Considerations

- Admin-only functions protected by deployer key verification
- Bid validation prevents double-spending and invalid amounts
- Auction timing enforced on-chain to prevent manipulation
- Token account ownership verification for all operations