import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";

describe("simple-test", () => {
  it("should connect to the local validator", async () => {
    const connection = new Connection("http://localhost:8899", {
      commitment: "confirmed",
    });
    
    // Check if the connection is established
    const version = await connection.getVersion();
    console.log("Solana version:", version);
    
    // Get accounts
    const accounts = await connection.getProgramAccounts(
      new anchor.web3.PublicKey("96Vc5syD9Fh7xHr3xTsb6mfHaEnwWVkDtkAFGNtA85i1")
    );
    console.log("Found accounts:", accounts.length);
  });
}); 