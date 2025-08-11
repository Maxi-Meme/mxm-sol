# Maxi.auction

    ███╗   ███╗ █████╗ ██╗  ██╗██╗   ███╗   ███╗███████╗███╗   ███╗███████╗
    ████╗ ████║██╔══██╗╚██╗██╔╝██║   ████╗ ████║██╔════╝████╗ ████║██╔════╝
    ██╔████╔██║███████║ ╚███╔╝ ██║   ██╔████╔██║█████╗  ██╔████╔██║█████╗
    ██║╚██╔╝██║██╔══██║ ██╔██╗ ██║   ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝
    ██║ ╚═╝ ██║██║  ██║██╔╝ ██╗██║   ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗
    ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝

"This auction is conducted in the Dutch format, characterized by a descending price mechanism. The final transaction price is established at the lowest bid accepted."

...moon soon!

![Onchain tests](/mxm-test-9aug2025.png)

## Environment Setup

### Required Dependencies and Versions
- Solana CLI: version 2.0.20 // https://solana.com/docs/intro/installation
  ```
  sh -c "$(curl -sSfL https://release.anza.xyz/v2.0.20/install)"
  ```
- Rust: version 1.85.0 
  ```
  rustup install 1.85.0 && rustup default 1.85.0
  ```
- Anchor CLI: version 0.30.1
  ```
  cargo install --git https://github.com/coral-xyz/anchor avm --force
  avm install 0.30.1 && avm use 0.30.1
  ```

### Add Solana to your PATH
```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
```

## Contract Instructions

The contract supports the following key operations:
- `initialize` - Initialize the auction system
- `create_auction` - Create a new auction
- `place_bid` - Place a bid in an auction
- `claim` - Claim auction rewards

## Local Development Setup

1. **Download required MPL programs**:
```bash
mkdir -p ./mpl
solana program dump -u m metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s ./mpl/mpl-token-metadata.so
solana program dump -u m BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY ./mpl/mpl-bubblegum.so
solana program dump -u m CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d ./mpl/mpl-core.so
```

2. **Use the provided mpl.sh script**:
```bash
./mpl.sh
```
This script will start Solana test validator with the required programs and prompt whether to reset the ledger.

3. **Configure Solana CLI to use local validator**:
```bash
solana config set --url http://127.0.0.1:8899/
solana config set --keypair ./id.json
```

4. **Get test SOL**:
```bash
solana airdrop 10
# Alternative if needed:
# solana transfer ajGmFUiZVFtf83DaNf4yyXjHef9CgePn6hWUJunmaxi 1 --allow-unfunded-recipient
```

5. **Build and deploy**:
```bash
cargo clean && cargo build
export RUSTUP_TOOLCHAIN=nightly-2024-11-19 && anchor build
RUSTUP_TOOLCHAIN='nightly-2024-11-19' anchor build -- -- -Znext-lockfile-bump
```

5b. ** If you see error[E0599]: no method named `source_file` found for struct `proc_macro2::Span` in the current scope [duplicate] or similar **
`cargo update -p proc-macro2 --precise 1.0.94`

5c. ** If you see   lock file version 4 requires `-Znext-lockfile-bump` **
`anchor build -- -- -Znext-lockfile-bump`

6. **Copy compiled program for deployment**:
```bash
cp target/sbf-solana-solana/release/maxi_auction.so target/deploy/
```

7. **Deploy the program**:
```bash
anchor deploy --provider.cluster localnet
```

##
## Program ID Management
##

9. **Initialize the contract**
  ```bash
  ANCHOR_PROVIDER_URL=http://0.0.0.0:8899 ANCHOR_WALLET=./id.json npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "initializes the contract"
  ```
### Create New Program ID 
  If data structures have changed, create a new program ID:
  ```bash
  solana-keygen new -o target/deploy/maxi_auction-keypair.json --force # current: 91goNr81mVpKwS44xi71E6dSVcr4o2vcF6WnYD1bEJ8U // 3UGQHeMjgnGn5wCnekaVZNEEp5j1oVt1dj5q7dTiw8ZF
  anchor keys sync  # syncs anchor.toml & lib.rs with the new ID
  anchor build -- -- -Znext-lockfile-bump
  ```

  Updating IDL & Types in Web & API, if you have access:
  ```bash
  cp target/idl/maxi_auction.json ../mxm-api/src/contract/idl && cp target/types/maxi_auction.ts ../mxm-api/src/contract/types && \
  cp target/idl/maxi_auction.json ../mxm-web/src/contract/idl && cp target/types/maxi_auction.ts ../mxm-web/src/contract/types
  ```

##
## Admin KeyPair ### this is the deployer/admin KP ###
##
  Create a new admin keypair:
  ```bash
  solana-keygen new -o ./id.json # current devnet admin: HvBkadNgPmh9ULx3mxauemytQNQ4pcoh7H6L58CoAHEj
  npm run display_id_privkey     # verify the private key for API use
  solana-keygen pubkey id.json   # verify the public key for web use
  solana config set --keypair ./id.json 
  ```

## Common Issues and Solutions

### IDL Build Errors

If you encounter an error like:
```
error[E0599]: no method named `source_file` found for struct `proc_macro2::Span` in the current scope
```

Or:
```
error[E0599]: no method named `file` found for struct `proc_macro2::Span` in the current scope
```

**Solution**: Edit the anchor-syn library file:
```bash
# Find the file first
find ~/.cargo -name "defined.rs" | grep anchor-syn-0.30.1

# Edit the file at line 499 (change file() to source_file() or vice versa)
# Replace:
let source_path = proc_macro2::Span::call_site().file().to_string();
# With:
let source_path = proc_macro2::Span::call_site().source_file().path();
```

### Program ID Mismatch

If you encounter this error:
```
Program log: AnchorError occurred. Error Code: DeclaredProgramIdMismatch. Error Number: 4100. Error Message: The declared program id does not match the actual program id.
```

**Solution**: Make sure the program ID in `lib.rs` and `Anchor.toml` matches the deployed program ID.

After deploying, check the output for the Program ID and update both files accordingly:
```bash
# In Anchor.toml
maxi_auction = "YOUR_DEPLOYED_PROGRAM_ID"

# In programs/maxi-auction/src/lib.rs 
declare_id!("YOUR_DEPLOYED_PROGRAM_ID");
```

### ELF Error During Deployment

If you encounter:
```
Error: ELF error: ELF error: Failed to parse ELF file: Section or symbol name `.note.gnu.build-` is longer than `16` bytes
```

**Solution**: Use the correctly compiled SBF file:
```bash
cp target/sbf-solana-solana/release/maxi_auction.so target/deploy/
```

## Devnet Airdrops

```bash
solana config set --url devnet
solana airdrop 2 --url devnet  # use VPN if you see "rate limit"
```
You might encounter rate limiting. Use a VPN if this happens.

## Running Tests

### Build & Deploy

LOCALNET - npm run lv && npm run bd:local
```bash
./mpl.sh
export ANCHOR_PROVIDER_URL=http://0.0.0.0:8899 RUSTUP_TOOLCHAIN=nightly-2024-11-19 ANCHOR_WALLET=./id.json && solana config set --url http://127.0.0.1:8899/
anchor build -- -- -Znext-lockfile-bump  --features localnet && anchor deploy --provider.cluster localnet --provider.wallet ./id.json
```

DEVNET - npm run bd:dev
```bash
export ANCHOR_PROVIDER_URL=https://kassandra-lv8wse-fast-devnet.helius-rpc.com RUSTUP_TOOLCHAIN=nightly-2024-11-19 ANCHOR_WALLET=./id.json && solana config set --url devnet
anchor build -- -- -Znext-lockfile-bump  --features devnet && anchor deploy --provider.cluster https://kassandra-lv8wse-fast-devnet.helius-rpc.com --provider.wallet ./id.json 
  # measured deploy cost devnet: ~3.2 SOL
```

### Exec Tests
```bash
# run all 
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --reporter spec

# dbg
#npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "initializes the contract" 

# base - auction creation & bidding, & cancel
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - creates an auction"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - creates a 1 min auction" 
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - creates a 1 hr auction" 
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - admin creates & bids 50%, 1 min, no claim"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - admin creates & bids 100%, 1 min, no claim"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - creates a 2 min auction" 
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - user can bid twice" # two bids
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - bids continuously" # many bids -- INCLUDING EXPECTED ERROR CASE BIDDING AFTER AUCTION ENDS!
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - bids and cancels continuously" # many bids & cancels
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - user 1 fills & claims auction" #### moveliq - e2e - admin + user 1
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - places a bid"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - places a bid with 0.5% fee"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - places a late bid"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "base - fails when bid size is below minimum" # anti DoS
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "cancels - only during auction period"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "cancels - bids from different users"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "cancels - bids from same user"

# stress tests
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "stress - handles 100 bids from multiple users" # stress test

# auction fills
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "fills - no bids after filled"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "fills - auction fully filled" # moveliq on devnet

# claims
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - only after auction is finished"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - failedMinNotReached" # sensitive to config.TEST_MIN_TOTAL_SOL!
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - same user two bids failedMinNotReached" # sensitive to config.TEST_MIN_TOTAL_SOL!
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - full supply not bid"

# claims - e2e, w/ moveliq !!! to trigger liquidity movement, make sure that MOVELIQ_PAUSE = false !!!
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - e2e - successful auction" ### moveliq (base case: moveliq happens before claims)
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - e2e - low settlement price" ### moveliq single bid at last moment (36s duration, bid at 34s)
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - e2e - withdraws & movesliq after claims" ### moveliq (pathological case: all claims happen first)
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - e2e - failed low clearing price" # tests moveliq aborts if failedMinNotReached 
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "claims - auction creator bids & claims" # moveliq
    
    # admin - withdraw sol & tokens (subsystem of moveliq)
    clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - no withdraws during auction"
    clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - withdraws after auction with 2 distinct bids" # tests withdraw_sol & withdraw_tokens

# pools - prices, swaps, tx's
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/pools.spec.ts --grep "pools - clmm tx history and real-time monitor"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/pools.spec.ts --grep "pools - price & preview match"

# [REF] referrals - admin functions
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - gets and logs all referral mappings"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - adds referral mapping successfully"

# [REF] referrals - bid fees (w/ zero ref fee config -- check backcompat)
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "referrals - bid with referrer when config is zero behaves normally"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "referrals - normal claim still works with referral mapping set"

# [REF] referrals - positive fee sharing tests (non-zero config)
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "referrals - referrer receives 20% of platform fees"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "referrals - multiple bidders same referrer accumulates fees"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "referrals - 100% fee share gives all fees to referrer"

# fees - distribution tests - multiple fee accounts
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "fees - bid fees across multiple fee accounts" # validates bid fees distributed correctly
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "fees - migration fees across multiple accounts" # validates migration fees distributed correctly

#
# admin - list auctions & view config
#
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - view current config"
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - rotate admin key to new keypair"  # test admin key rotation for compromised keys
clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - list auctions & pools"

    # admin - cleanups - ## run in this order to recover!! ##
    clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - pools - remove liquidity ###" # WITHDRAW LIOUIDITY
    clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "admin - finalize finished auctions ###" ### HARD NUKE ALL ACCOUNTS 

# test metadata
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates auction with dynamic meme data" # meme-themed tokens with crypto culture references
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates auction with dynamic DeFi data" # DeFi-themed tokens with financial terminology  
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates auction with dynamic gaming data" # gaming-themed tokens with game terminology
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates auction with dynamic AI data" # AI-themed tokens with technology terminology
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates auction with random dynamic data" # random test data generation without theme constraints
# clear && npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts --grep "testdata - creates multiple diverse auctions and bids" # comprehensive test with multiple themes + bidding

#------------

# p0 - test review: e2e target 100%
#      ## LOCK LIQUIDITY ... remove admin-withdraw ability ##
#      finish CC contract review (admin-pause?)
#      multi-sig for admin ops? 
#      review with oai & grok
#      
#      (grind more prod keypairs)

# p1 - profile pics on bubbles & holders list
# p1 - x posts img missing
# p1 - socials on upcoming (and others) hard to find

# p2 - txids for bid list

# p2 ->> /docs -- review more
# p2 ->> review x terms
# p2 ->> setup email
# p2 ->> https://maxi.meme/privacy - review
# p3 ->> https://maxi.meme/terms - review

# p3 - move api caches to redis? (shared)
# p3 - auctionId usages: definite race conditions everywhere... try to minimize (use mint instead where possible), e.g. createAuction in BlockchainController...

# p4 - 2x unknown tx's 

> MAINNET TESTING...

> SOFT LAUNCH...

# p1 - Ads Boost // just take sol, record boosted in KeyPair/auction_x_post table; prioritize on feed

# p3 - ref's leaderboard...
# p3 - min. # of REFs to claim Airdrop... (??)
# p3 - Leaderboards: move to separate jobs, out of the api... 

# p4 - refund creator costs // better make completely free... big rework (no onchain until first bid...)

>>>>>>>>>>>>>>>>>>>>>

exec summary 

* 0.69% sol fee on bids, non-refundable
* 0.69% sol & tokens fee on liquidity migration ("graduation" to raydium)
* up to 6.9% of launch tokens can be gifted to x accounts; the corresponding bid sol for those tokens is used to buy & burn from the Raydium pool
* referals: give 6.9% of referred users' bid fees to the referrer

* todo: platform retains LP tokens on Raydium pools and will distribute trading fees via its token launch later
