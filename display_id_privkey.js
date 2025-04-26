const fs = require('fs').promises; // Use promises for async file reading
const bs58 = require('bs58').default; // Base58 encoding library

async function convertKeypairToBase58(filePath = './id.json') {
  try {
    // Read the JSON file
    const data = await fs.readFile(filePath, 'utf8');
    
    // Parse JSON to get the byte array
    const keypairArray = JSON.parse(data);
    
    // Validate the array
    if (!Array.isArray(keypairArray) || keypairArray.length !== 64) {
      throw new Error('Invalid keypair: Must be a 64-byte array');
    }
    
    // Convert array to Uint8Array
    const keypairBytes = Uint8Array.from(keypairArray);
    
    // Encode to base58
    const base58String = bs58.encode(keypairBytes);
    
    // Output the result
    console.log('Base58 Keypair:', base58String);
    
    return base58String;
  } catch (error) {
    console.error('Error converting keypair:', error.message);
    throw error;
  }
}

// Export the function for use in scripts
module.exports = convertKeypairToBase58;

// Run the function if called directly from command line
if (require.main === module) {
  convertKeypairToBase58();
}

