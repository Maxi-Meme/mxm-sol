// Example usage of dynamic network detection
import { IS_LOCAL, IS_DEVNET, IS_MAINNET, getCurrentNetwork } from "./config";

console.log("=== Dynamic Network Detection Example ===");
console.log(`Current Network: ${getCurrentNetwork()}`);
console.log(`Environment Variables:`);
console.log(`  IS_LOCAL: ${IS_LOCAL}`);
console.log(`  IS_DEVNET: ${IS_DEVNET}`);
console.log(`  IS_MAINNET: ${IS_MAINNET}`);
console.log(`ANCHOR_PROVIDER_URL: ${process.env.ANCHOR_PROVIDER_URL}`);

// Example usage in conditional logic
if (IS_LOCAL) {
    console.log("🏠 Running on local network - using test configurations");
    // Use local-specific settings
} else if (IS_DEVNET) {
    console.log("🧪 Running on devnet - using development configurations");
    // Use devnet-specific settings
} else if (IS_MAINNET) {
    console.log("🚀 Running on mainnet - using production configurations");
    // Use mainnet-specific settings
} else {
    console.log("❓ Unknown network - check ANCHOR_PROVIDER_URL");
}

export {};
