import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MaxiAuction } from "../target/types/maxi_auction";
import { PublicKey } from "@solana/web3.js";

const globalInfoSeed = Buffer.from("global_info_seed");

describe("Initialize Maxi Auction Program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MaxiAuction as Program<MaxiAuction>;
  
  it("Initialize the program state", async () => {
    console.log("Program ID:", program.programId.toString());
    
    const [globalInfo] = PublicKey.findProgramAddressSync(
      [globalInfoSeed],
      program.programId
    );
    
    console.log("Global Info PDA:", globalInfo.toString());
    
    try {
      // Check if global info already exists
      try {
        const globalInfoAccount = await program.account.globalInfo.fetch(
          globalInfo
        );
        console.log("Global info already exists:", globalInfoAccount);
        return;
      } catch (e) {
        console.log("Global info doesn't exist yet, creating it...");
      }
      
      // Get the initialization accounts and params from the IDL
      const idl = program.idl;
      console.log("Looking for initialize instruction in IDL...");
      
      // Find the initialize method in the IDL
      const initializeIx = idl.instructions.find(ix => ix.name === "initialize");
      if (!initializeIx) {
        console.error("Initialize instruction not found in IDL");
        return;
      }
      
      console.log("Initialize instruction found:", initializeIx);
      
      // Initialize program based on the accounts found in the IDL
      const tx = await program.methods
        .initialize({
          admin: provider.wallet.publicKey,
          defaultTokenSupply: new anchor.BN(1000000),
          defaultTokenDecimals: 6,
          defaultStartPriceLamports: new anchor.BN(100000000),
          defaultLockPercent: new anchor.BN(69)
        })
        .accounts({
          signer: provider.wallet.publicKey,
          globalInfo: globalInfo,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log("Program initialized with transaction:", tx);
      
      // Fetch and display the global info
      const globalInfoAccount = await program.account.globalInfo.fetch(
        globalInfo
      );
      
      console.log("Global info created:", globalInfoAccount);
    } catch (e) {
      console.error("Error initializing program:", e);
    }
  });
}); 