import { Connection, Keypair } from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

export const globalInfoSeed = "global_info_seed";
export const auctionSolSeed = "auction_sol_seed";
export const auctionDataSeed = "auction_data_seed";
export const auctionBidsSeed = "bids_seed";
export const referralMappingsSeed = "referral_mappings"; // [REF] - Referral system constants

// Fee account configuration
const TEST_FEE_ACCOUNT = Keypair.fromSecretKey(bs58.decode("4hbfT4t6HZtcBVUq983nHXnXs7KdQXxrNUdkCVPaNYT82qSd3hH7eVJkgVicHX9MtatidQuEi3E5nXJ5UbE9ExHp")); // 1st test fee account: 12MhCcaTUtiG86K5ahiAmYSZ4Z9VCsxUKSTcAQjimaxi
const TEST_FEE_ACCOUNT_2 = Keypair.fromSecretKey(bs58.decode("611ANMLeWpM8rVF5afGGEn2SDVMrnYZ82Ga27kL6BJ6bE6p1FKfiUcCGwnN2ot3jgVpFrDgVYLxCi9jka5aZMdNr")); // 2nd test fee account: hzpkmpofVCmoQNRDZaM6BhWdXA64Py1MX3prVmaxi
const TEST_FEE_ACCOUNT_3 = Keypair.fromSecretKey(bs58.decode("4ieqTBhBPBtW1jw8eWYEou9AJLq5Doz87mbGP6ng8twtAxd2u1hKHiSe4AZkdYckLmQUV66PyoBpGnuKMmWHVipi")); // 3rd test fee account: 128SvYHMZwnLNZnHHhs6AT9vxQNt5qsSgW2CwLXQmaxi

// Combined fee accounts configuration for easy use in tests
export const FEE_ACCOUNTS = [
    // 100% - legacy 
    //{ pubkey: TEST_FEE_ACCOUNT.publicKey, share: 10000 }

    // launch
    { pubkey: TEST_FEE_ACCOUNT.publicKey, share: 5000 },
    { pubkey: TEST_FEE_ACCOUNT_2.publicKey, share: 5000 },

    //{ pubkey: TEST_FEE_ACCOUNT.publicKey, share: 4500 }, 
    //{ pubkey: TEST_FEE_ACCOUNT_2.publicKey, share: 4500 },
    //{ pubkey: TEST_FEE_ACCOUNT_3.publicKey, share: 1000 } 
];

export const TEST_DAO_ACCOUNT = Keypair.fromSecretKey(bs58.decode("5eGYNKTZty4AWiDXXkEmM9D4dwGTAZoYxBLHd8XWsGkF3Q32yesom9ituWQERMAQHBa41wXHzHYgEDEnaskMgQmx")); // VgzE1W2szAaKkH6ynnqM8wPHtd4Kf8MTjPJP5HRmaxi

export const TEST_TOKEN_NAME = "(AT) T69M";
export const TEST_TOKEN_SYMBOL = "T69M";
export const TEST_TOKEN_URI = "https://ipfs.io/ipfs/QmWVzSC1ZTFiBYFiZZ6QivGUZ9awPJwqZECSFL1UD4gitC";

//
// Token constants - system defaults
// **** MAKE SURE THAT THESE VALUES MATCH THE VALUES IN THE AirDropForm.tsx ****
//
export const MAXIMEME_TOKEN_DECIMALS = 6; // 9 fails on devnet moveliq - not enough test lamport liq (~21286976) for token lamports

// for 69... total mint: ASSUMES 0.69% FEE!
export const MAXIMEME_TOKEN_SUPPLY = 35023466 /* even number pls for tests to avoid rounding errors */
    * Math.pow(10, MAXIMEME_TOKEN_DECIMALS); // for 69m total supply w/ overmint
//export const MAXIMEME_TOKEN_SUPPLY = 502_512_562 * Math.pow(10, MAXIMEME_TOKEN_DECIMALS); // for ~1b total supply w/ overmint
//export const MAXIMEME_TOKEN_SUPPLY = 100  Math.pow(10, MAXIMEME_TOKEN_DECIMALS); // test amount

export const TEST_STARTPRICE_SOL = 0.000000100; // 100 lamport start price - linear decay to min (1 lamport)
//export const TEST_STARTPRICE_SOL = 0.000000001; // ### 1 lamport!! is actually min price in contract: can't set that as start price and have any decrease...
//export const TEST_STARTPRICE_SOL = 0.001; // test amount: ~= 1,000,000 lamports start price // [auction_sol_account min rent ~= 0.00089] 

// not used/ignored - old method (2) - see place_bid.rs
export const TEST_DISTRIBUTION_PERCENT = 9631; // 96.31%

//
// auction will fail if sol *withdrawn** (not raied!) is < this, and bidders can claim back their sol in that case
//  for new Option 2 for liquidity, this value needs to be v. low (we only withdraw ~3% of raised!)
//
// auctions will flag as failed if sol raised is < this, and bidders can claim back their sol in that case
//
export const TEST_MIN_TOTAL_SOL = 0.0008;

// [REF] - Referral system configuration - SET TO ZERO for backward compatibility testing
export const TEST_REF_BID_FEE_PERC_SHARE = 690;      // 6.9%
//export const TEST_REF_BID_FEE_PERC_SHARE = 0;      // 0% - no referral fee sharing initially

// Minimum bid size configuration
export const TEST_MIN_BID_SIZE = 1000;               // 1000 lamports default minimum bid size 
