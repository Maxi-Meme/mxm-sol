# Maxi.auction

"This auction is conducted in the Dutch format, characterized by a descending price mechanism. The final transaction price is established at the lowest bid accepted."

## Main Instructions

- initialize

- create_auction

- place_bid

- claim

- accept_auction

## Compile and Deploy to DevNet & Azure

- (1) Make sure you have solana installed `solana-cli 2.0.20` // https://solana.com/docs/intro/installation
 > `solana --version` // solana-cli 2.1.15 (src:53545685; feat:3271415109, client:Agave)
 > `rustc --version` // rustc 1.85.0 (4d91de4e4 2025-02-17)
 > `anchor --version` // anchor-cli 0.30.1

- Install phantom wallet on the browser or any from the list
- Make sure u have a solana wallet with SOL token (devnet)

## NEW PROGRAM ID - optional

- Create a new program ID (optional - if data/structs have changed, then probably need to do this to avoid serialization problems):
    `solana-keygen new -o target/deploy/maxi_auction-keypair.json --force` // AuYwiNyd1y3cUchTzrFsML5KasUgYWYHvMncxEBCVWhX
    `anchor keys sync` // syncs anchor.toml & lib.rs

## DEPLOY TO DEVNET

- Set cluster to devnet:
    `solana config set --url devnet`

- Create wallet if not already, if not already:
    `solana-keygen new -o ./id.json`

- Configure new wallet as main keypair, if not already:
    `solana config set --keypair ./id.json`
        `solana-keygen pubkey ./id.json` // just to view it

- Get some devnet sol, build & deploy:
    `solana airdrop 2 --url devnet` // use VPN if you see "rate limit"
    `anchor build -- --features=devnet`
    `anchor deploy --provider.cluster devnet --provider.wallet ./id.json`

- initialize the deployed SC
    `nvm use 22.13.0 && anchor test --skip-local-validator --skip-build --skip-deploy`
    ANCHOR_PROVIDER_URL=https://devnet.helius-rpc.com/?api-key=27fd6baa-75e9-4d39-9832-d5a43419ad78 ANCHOR_WALLET=./id.json \
        npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts 

## COMPILE & DEPLOY LOCALLY

(1) > Anchor.toml: cluster = "localnet"
    [   ????
        (2) > config.ts: comment out the devnet top reference to local
        (3) > `anchor test` -- leave it running to keep local validator running on http://127.0.0.1:8899/
        // https://solana.com/developers/cookbook/development/start-local-validator
    ]

 (2) manual deploy onto local validator:
    1. `solana-test-validator` // ####### use step 7 below instead... 
    2. `solana config set --url http://127.0.0.1:8899/`
    3. `solana airdrop 10` > https://solscan.io/?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899%2F
    3b. or: `solana transfer ajGmFUiZVFtf83DaNf4yyXjHef9CgePn6hWUJunmaxi 1  --allow-unfunded-recipient`
    4. `anchor build`
    5. `anchor deploy --provider.cluster localnet`

  (3) Update IDL & Types in Web & Api
`cp target/idl/maxi_auction.json ../mxm-api/src/contract/idl && cp target/types/maxi_auction.ts ../mxm-api/src/contract/types`
`cp target/idl/maxi_auction.json ../mxm-web/src/contract/idl && cp target/types/maxi_auction.ts ../mxm-web/src/contract/types`

    // ******** "initialize" the deployed SC ******** >>
        >> nvm use 22.13.0 && anchor test --skip-local-validator --skip-build --skip-deploy` // localnet
        OR: 
            ANCHOR_PROVIDER_URL=http://0.0.0.0:8899 ANCHOR_WALLET=./id.json npx ts-mocha -p ./tsconfig.json -t 1000000 tests/maxi-auction.ts

    7. https://developers.metaplex.com/guides/setup-a-local-validator
    7a. `mkdir ./mpl`
    7b. `solana program dump -u m metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s ./mpl/mpl-token-metadata.so`
    7c. `solana program dump -u m BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY  ./mpl/bubblegum.so`
    7d. `solana program dump -u m CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d  ./mpl/mpl-core.so`
    7e. nano mpl.sh >
#!/bin/bash
COMMAND="solana-test-validator -r --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s ./mpl/mpl-token-metadata.so --bpf-program BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY ./mpl/mpl-bubblegum.so --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d ./mpl/mpl-core.so"
for arg in "$@"
do
    COMMAND+=" $arg"
done
eval $COMMAND

    7f. `sudo chmod +x ./mpl.sh`
    7g. `rm -rf ./test-ledger`
    7h. >>>> `./mpl.sh` // run solana-test-validator w/ multiplex libs loaded...

  
## Test -- run local validator as above, & init the SC then:

>>> export ANCHOR_PROVIDER_URL=http://0.0.0.0:8899 ANCHOR_WALLET=./id.json \
    npx ts-mocha -p ./tsconfig.json -t 1000000 tests/get-version.ts --grep "maxi-auction version test"





