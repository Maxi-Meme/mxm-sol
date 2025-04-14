import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { MaxiAuction } from "../target/types/maxi_auction";
import keypair from "../id.json";
import logger from "node-color-log";
import { connection } from "./config";

describe("maxi-auction version test", () => {
  // Configure the client to use the local cluster
  var providerEnv = anchor.AnchorProvider.env();
  anchor.setProvider(providerEnv);
  
  const program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;
  const adminKp = Keypair.fromSecretKey(Uint8Array.from(keypair));

  it("Should return the version number", async () => {
    logger.color("green").log("Getting contract version from IDL...");

    // Access the version directly from the IDL metadata
    const idl = program.idl;
    const version = idl.metadata.version;
    
    logger.color("cyan").log(`Contract version: ${version}`);
    
    // Assert that the version is a string and follows semantic versioning format
    console.assert(typeof version === "string", "Version should be a string");
    console.assert(/^\d+\.\d+\.\d+$/.test(version), "Version should follow semantic versioning format");
  });
});
