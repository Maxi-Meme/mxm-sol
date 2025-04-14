/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/maxi_auction.json`.
 */
export type MaxiAuction = {
  "address": "AuYwiNyd1y3cUchTzrFsML5KasUgYWYHvMncxEBCVWhX",
  "metadata": {
    "name": "maxiAuction",
    "version": "0.1.2",
    "spec": "0.1.0",
    "description": "Maxi Meme Yo!"
  },
  "instructions": [
    {
      "name": "cancelBid",
      "discriminator": [
        40,
        243,
        190,
        217,
        208,
        253,
        86,
        206
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "auctionSolAccount",
          "writable": true
        },
        {
          "name": "auctionDataAccount",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "globalInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  105,
                  110,
                  102,
                  111,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "callerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "auctionSolAccount",
          "writable": true
        },
        {
          "name": "auctionDataAccount",
          "writable": true
        },
        {
          "name": "auctionTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createAuction",
      "discriminator": [
        234,
        6,
        201,
        246,
        47,
        219,
        176,
        107
      ],
      "accounts": [
        {
          "name": "globalInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  105,
                  110,
                  102,
                  111,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "tokenMint",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMetadataAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "const",
                "value": [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          "name": "auctionSolAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  111,
                  108,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "global_info.auctions_num",
                "account": "globalInfo"
              }
            ]
          }
        },
        {
          "name": "auctionDataAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  100,
                  97,
                  116,
                  97,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "global_info.auctions_num",
                "account": "globalInfo"
              }
            ]
          }
        },
        {
          "name": "auctionTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "auctionSolAccount"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "sysvarRent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "mplTokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        }
      ],
      "args": [
        {
          "name": "xId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        },
        {
          "name": "durationHours",
          "type": "u64"
        },
        {
          "name": "lockPercent",
          "type": "u64"
        },
        {
          "name": "delayInSeconds",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  105,
                  110,
                  102,
                  111,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newConfig",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    },
    {
      "name": "placeBid",
      "discriminator": [
        238,
        77,
        148,
        91,
        200,
        151,
        92,
        146
      ],
      "accounts": [
        {
          "name": "globalInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  105,
                  110,
                  102,
                  111,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "bidder",
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "auctionSolAccount",
          "writable": true
        },
        {
          "name": "auctionDataAccount",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bidQty",
          "type": "u64"
        },
        {
          "name": "xId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "raydiumMigrate",
      "docs": [
        "Initiazlize a swap pool"
      ],
      "discriminator": [
        88,
        160,
        227,
        203,
        173,
        10,
        220,
        85
      ],
      "accounts": [
        {
          "name": "auctionSolAccount",
          "writable": true
        },
        {
          "name": "auctionDataAccount",
          "writable": true
        },
        {
          "name": "auctionTokenAccount",
          "writable": true
        },
        {
          "name": "ammProgram"
        },
        {
          "name": "amm",
          "writable": true
        },
        {
          "name": "ammAuthority"
        },
        {
          "name": "ammOpenOrders",
          "writable": true
        },
        {
          "name": "ammLpMint",
          "writable": true
        },
        {
          "name": "ammCoinMint"
        },
        {
          "name": "ammPcMint"
        },
        {
          "name": "ammCoinVault",
          "writable": true
        },
        {
          "name": "ammPcVault",
          "writable": true
        },
        {
          "name": "ammTargetOrders",
          "writable": true
        },
        {
          "name": "ammConfig"
        },
        {
          "name": "createFeeDestination",
          "writable": true
        },
        {
          "name": "marketProgram",
          "address": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
        },
        {
          "name": "market"
        },
        {
          "name": "userWallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "userTokenCoin",
          "writable": true
        },
        {
          "name": "userTokenPc",
          "writable": true
        },
        {
          "name": "userTokenLp",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "sysvarRent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u8"
        },
        {
          "name": "openTime",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setConfig",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  105,
                  110,
                  102,
                  111,
                  95,
                  115,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newConfig",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "auction",
      "discriminator": [
        218,
        94,
        247,
        242,
        126,
        233,
        131,
        81
      ]
    },
    {
      "name": "globalInfo",
      "discriminator": [
        241,
        51,
        8,
        81,
        11,
        62,
        44,
        62
      ]
    }
  ],
  "events": [
    {
      "name": "auctionCreated",
      "discriminator": [
        133,
        190,
        194,
        65,
        172,
        0,
        70,
        178
      ]
    },
    {
      "name": "auctionFilled",
      "discriminator": [
        179,
        194,
        228,
        99,
        108,
        245,
        165,
        110
      ]
    },
    {
      "name": "auctionMigrated",
      "discriminator": [
        99,
        23,
        224,
        10,
        163,
        127,
        21,
        243
      ]
    },
    {
      "name": "bidCancelled",
      "discriminator": [
        175,
        52,
        76,
        11,
        201,
        1,
        205,
        65
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "newBid",
      "discriminator": [
        112,
        117,
        144,
        35,
        214,
        129,
        18,
        168
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "calculationError",
      "msg": "Calculation error"
    },
    {
      "code": 6002,
      "name": "invalidTokenSupplyAndDecimals",
      "msg": "Token supply must be an integer with a specified decimal point."
    },
    {
      "code": 6003,
      "name": "invalidAuctionId",
      "msg": "Invalid Auction ID."
    },
    {
      "code": 6004,
      "name": "reentrancyGuard",
      "msg": "Reentrancy guard triggered."
    },
    {
      "code": 6005,
      "name": "notEnoughTokensLeft",
      "msg": "Not enough tokens left."
    },
    {
      "code": 6006,
      "name": "maxBidsReached",
      "msg": "Max number of bids reached."
    },
    {
      "code": 6007,
      "name": "auctionStillLive",
      "msg": "Auction is still live."
    },
    {
      "code": 6008,
      "name": "auctionEnded",
      "msg": "Auction is ended."
    },
    {
      "code": 6009,
      "name": "auctionNotFinished",
      "msg": "Auction is not finished."
    },
    {
      "code": 6010,
      "name": "noBidFoundForCaller",
      "msg": "No bid found for caller."
    },
    {
      "code": 6011,
      "name": "invalidClearingPrice",
      "msg": "Invalid clearing price."
    },
    {
      "code": 6012,
      "name": "invalidRemainingAccounts",
      "msg": "Invalid length of remaining accounts."
    },
    {
      "code": 6013,
      "name": "invalidUserAccount",
      "msg": "Invalid user account."
    },
    {
      "code": 6014,
      "name": "invalidUserTokenAccount",
      "msg": "Invalid user's token account."
    },
    {
      "code": 6015,
      "name": "bidAlreadyClaimed",
      "msg": "Bid already claimed."
    }
  ],
  "types": [
    {
      "name": "auction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "isFinished",
            "type": "bool"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "xId",
            "type": "u64"
          },
          {
            "name": "startTimestamp",
            "type": "i64"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          },
          {
            "name": "durationHours",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "tokenSupply",
            "type": "u64"
          },
          {
            "name": "tokenDecimals",
            "type": "u8"
          },
          {
            "name": "lockPercent",
            "type": "u64"
          },
          {
            "name": "isLocked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "delayInSeconds",
            "type": "u64"
          },
          {
            "name": "bids",
            "type": {
              "vec": {
                "defined": {
                  "name": "bid"
                }
              }
            }
          },
          {
            "name": "startPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auctionCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "xId",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "lockPercent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auctionFilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auctionMigrated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "xId",
            "type": "u64"
          },
          {
            "name": "bidTimestamp",
            "type": "i64"
          },
          {
            "name": "bidQty",
            "type": "u64"
          },
          {
            "name": "bidSol",
            "type": "u64"
          },
          {
            "name": "isClaimed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "bidCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "claimQty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "defaultTokenSupply",
            "type": "u64"
          },
          {
            "name": "defaultTokenDecimals",
            "type": "u8"
          },
          {
            "name": "defaultStartPriceSol",
            "type": "u64"
          },
          {
            "name": "defaultLockPercent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "globalInfo",
      "docs": [
        "Global state for the auction system."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deployer",
            "type": "pubkey"
          },
          {
            "name": "auctionsNum",
            "type": "u64"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "config"
              }
            }
          }
        ]
      }
    },
    {
      "name": "newBid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auctionId",
            "type": "u64"
          },
          {
            "name": "bidder",
            "type": "pubkey"
          },
          {
            "name": "xId",
            "type": "u64"
          },
          {
            "name": "bidSol",
            "type": "u64"
          },
          {
            "name": "bidQty",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
