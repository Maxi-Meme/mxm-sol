import { Connection } from "@solana/web3.js";

export const connection = new Connection("http://localhost:8899", {
  commitment: "confirmed",
});
// export const connection = new Connection(
//   "https://devnet.helius-rpc.com/?api-key=650bb4db-b1d0-4641-b7e1-afdea19a34c9",
//   { commitment: "confirmed" }
// );

export const globalInfoSeed = "global_info_seed";

export const auctionSolSeed = "auction_sol_seed";
export const auctionDataSeed = "auction_data_seed";


export const TestTokenDecimals = 6;
export const TestTokenName = "Test Token";
export const TestTokenSymbol = "TEST";
export const TestTokenUri =
  "https://ipfs.io/ipfs/QmWVzSC1ZTFiBYFiZZ6QivGUZ9awPJwqZECSFL1UD4gitC";

export const TestHours = 1;

//export const TestTokenSupply = 5_000_000_000; // 5000
export const TestTokenSupply = 100_000_000; // 100
export const TestStartPriceSol = 0.001; // auction_sol_account min rent ~= 0.00089

export const TestDefaultLockPercent = 69; // 69 / 1000 = 6.9%
export const TestLockPercent = 100; // 100 / 1000 = 10%
export const TestTokenQty = 100;

export const TestBidQty1 = 1000;
export const TestBidSol1 = 0.004;

export const TestBidQty2 = 3000;
export const TestBidSol2 = 0.002;

export const TestBidQty3 = 2000;
export const TestBidSol3 = 0.001;

export const TestBidQty4 = 1500;
export const TestBidSol4 = 0.0005;

export const TestBidQty5 = 1;
export const TestBidSol5 = 0.0001;
