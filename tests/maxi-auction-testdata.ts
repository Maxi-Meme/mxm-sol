import * as fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Environment variables for Pinata
const PINATA_PUBLIC_KEY = process.env.PINATA_PUBLIC_KEY || "";
const PINATA_PUBLIC_URL = "https://ipfs.io/ipfs/";

// Check if Pinata is properly configured
const isPinataConfigured = () => {
    return PINATA_PUBLIC_KEY && PINATA_PUBLIC_KEY.length > 50; // Basic validation
};

export interface TestTokenData {
    name: string;
    symbol: string;
    description: string;
    imageFile?: Buffer;
    imageExtension?: string;
    metadataUri?: string;
    telegramLink?: string;
    websiteLink?: string;
    twitterLink?: string;
}

/**
 * Upload image buffer to Pinata IPFS
 */
async function uploadImageToPinata(imageBuffer: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', imageBuffer, filename);

    const defaultHeaders = {
        'Authorization': `Bearer ${PINATA_PUBLIC_KEY}`,
    };

    const imgRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: defaultHeaders,
        body: formData,
    });

    if (!imgRes.ok) {
        const errorData = await imgRes.text();
        throw new Error(`Error pinning file: ${imgRes.statusText} - ${errorData}`);
    }

    const imgJsonData = await imgRes.json();
    return PINATA_PUBLIC_URL + imgJsonData.IpfsHash;
}

/**
 * Upload metadata JSON to Pinata IPFS
 */
async function uploadMetadataToPinata(name: string, symbol: string, description: string, imageUrl: string): Promise<string> {
    const pinataContent = {
        name,
        symbol,
        image: imageUrl,
        description: description,
    };

    const defaultHeaders = {
        'Authorization': `Bearer ${PINATA_PUBLIC_KEY}`,
        'Content-Type': 'application/json',
    };

    const jsonRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
            pinataContent,
        }),
    });

    if (!jsonRes.ok) {
        const errorData = await jsonRes.text();
        throw new Error(`Error uploading metadata: ${jsonRes.statusText} - ${errorData}`);
    }

    const jsonData = await jsonRes.json();
    return PINATA_PUBLIC_URL + jsonData.IpfsHash;
}

/**
 * Fetch Giphy content by search term
 */
async function getGiphyContent(searchTerm: string, limit: number = 10): Promise<{ gifs: string[]; stills: string[] }> {
    const apiKey = 'ME3VTJuVjKgmXfmoEjlV4Ku62U1YwLRE';
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(searchTerm)}&limit=${limit}&rating=r`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const gifs = data.data.map((item: any) => item.images.fixed_height.url);
        const stills = data.data.map((item: any) => item.images.fixed_height_still.url);

        return { gifs, stills };
    } catch (error) {
        console.error('Error fetching Giphy content:', error);
        return { gifs: [], stills: [] };
    }
}

/**
 * Generate a simple SVG image as a fallback
 */
function generateSvgImage(tokenSymbol: string, width: number = 800, height: number = 800): Buffer {
    // Generate a random colored background
    const colors = [
        "#FF6B6B", "#4ECDC4", "#FFD166", "#06D6A0", "#118AB2",
        "#8338EC", "#EF476F", "#FFBE0B", "#3A86FF", "#FB5607",
        "#FFD1DC", "#A2E1DB", "#FDFFAB", "#B8E0D2", "#ACBCFF",
        "#581845", "#283149", "#2F4858", "#3D315B", "#1A1A2E",
        "#00FFFF", "#FF00FF", "#7CFC00", "#9966FF", "#16C79A",
        "#FF9A76", "#93B5C6", "#FFAAA7", "#D8E3E7", "#51C2D5",
        "#F7931A", "#627EEA", "#23D199", "#345D9D", "#C2A633"
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    // Random meme texts
    const memeTexts = [
        { top: "HODL", bottom: "TO THE MOON" },
        { top: "BUY HIGH", bottom: "SELL LOW" },
        { top: "ONE MORE", bottom: "CRYPTO DIP" },
        { top: "NOT FINANCIAL", bottom: "ADVICE" },
        { top: "THIS IS", bottom: "THE WAY" },
        { top: "DIAMOND", bottom: "HANDS" },
        { top: "WHEN", bottom: "LAMBO?" },
        { top: "CRYPTO", bottom: "NEVER SLEEPS" },
        { top: "NFT", bottom: "RIGHT CLICK SAVE" },
        { top: "BLOCKCHAIN", bottom: "REVOLUTION" },
        { top: "AUTOTEST", bottom: "TOKEN" },
        { top: "TEST", bottom: "SUITE MAGIC" },
        { top: "AUTOMATED", bottom: "TESTING" }
    ];

    const randomMemeIndex = Math.floor(Math.random() * memeTexts.length);
    const memeText = memeTexts[randomMemeIndex];

    // Create SVG content
    const svgContent = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${randomColor};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#000000;stop-opacity:0.8" />
                </linearGradient>
            </defs>
            
            <!-- Background -->
            <rect width="100%" height="100%" fill="url(#grad1)" />
            
            <!-- Random circles for decoration -->
            <circle cx="${Math.random() * width}" cy="${Math.random() * height}" r="${30 + Math.random() * 50}" fill="rgba(255,255,255,0.1)" />
            <circle cx="${Math.random() * width}" cy="${Math.random() * height}" r="${30 + Math.random() * 50}" fill="rgba(255,255,255,0.1)" />
            <circle cx="${Math.random() * width}" cy="${Math.random() * height}" r="${30 + Math.random() * 50}" fill="rgba(255,255,255,0.1)" />
            
            <!-- Top text -->
            <text x="${width / 2}" y="150" font-family="Arial Black, Arial" font-size="60" font-weight="bold" 
                    text-anchor="middle" fill="white" stroke="black" stroke-width="3">${memeText.top}</text>
            
            <!-- Center token symbol -->
            <text x="${width / 2}" y="${height / 2}" font-family="Arial Black, Arial" font-size="100" font-weight="bold" 
                    text-anchor="middle" fill="white" stroke="black" stroke-width="4">${tokenSymbol}</text>
            
            <!-- Bottom text -->
            <text x="${width / 2}" y="${height - 150}" font-family="Arial Black, Arial" font-size="60" font-weight="bold" 
                    text-anchor="middle" fill="white" stroke="black" stroke-width="3">${memeText.bottom}</text>
        </svg>
    `;

    return Buffer.from(svgContent, 'utf8');
}

/**
 * Detect file extension from URL or content
 */
function detectFileExtension(url: string, buffer?: Buffer): string {
    if (url.includes('.gif')) return 'gif';
    if (url.includes('.png')) return 'png';
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'jpg';
    if (url.includes('.webp')) return 'webp';

    // Check buffer magic bytes for common formats
    if (buffer) {
        if (buffer.length >= 4) {
            // GIF magic bytes
            if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
            // PNG magic bytes
            if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
            // JPEG magic bytes
            if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'jpg';
        }
    }

    return 'png'; // Default fallback
}

/**
 * Generate random social links
 */
function generateSocialLinks(tokenName: string): { telegram: string; website: string; twitter: string } {
    const telegramNames = ["moonshot", "diamondhands", "cryptosociety", "tokenomics", "tokenlounge", "hodlgang", "tothemoon", "cryptowhales"];
    const randomTelegramName = telegramNames[Math.floor(Math.random() * telegramNames.length)];
    const telegramLink = `https://t.me/${randomTelegramName}_autotest`;

    const websiteDomains = ["crypto", "defi", "blockchain", "token", "finance", "web3", "meta"];
    const tlds = [".io", ".finance", ".network", ".xyz", ".app", ".tech", ".space"];
    const randomDomain = websiteDomains[Math.floor(Math.random() * websiteDomains.length)];
    const randomTld = tlds[Math.floor(Math.random() * tlds.length)];
    const websiteLink = `https://${tokenName.toLowerCase().replace(/\s+/g, "")}-${randomDomain}${randomTld}`;

    const twitterNames = ["crypto", "defi", "token", "finance", "web3", "meta", "blockchain"];
    const randomTwitterName = twitterNames[Math.floor(Math.random() * twitterNames.length)];
    const twitterLink = `https://x.com/${tokenName.toLowerCase().replace(/\s+/g, "")}_${randomTwitterName}_test`;

    return {
        telegram: telegramLink,
        website: websiteLink,
        twitter: twitterLink
    };
}

/**
 * Generate comprehensive test token data
 */
export async function generateTestTokenData(): Promise<TestTokenData> {
    // Generate random token name and symbol
    const prefixes = [
        "Cosmic", "Cyber", "Quantum", "Astro", "Crypto", "Digital", "Pixel", "Solar", "Lunar", "Tech",
        "Nebula", "Stellar", "Alpha", "Gamma", "Nexus", "Nova", "Orbit", "Photon", "Quasar", "Echo",
        "Hyper", "Meta", "Pulse", "Synth", "Vector", "Spark", "Zenith", "Fusion", "Atomic", "Omega",
        "Prism", "Vortex", "Matrix", "Neural", "Flux", "Zero", "Ultra", "Rapid", "Sonic", "Turbo"
    ];

    const suffixes = [
        "Token", "Coin", "Finance", "Chain", "Cash", "Pay", "Money", "Gold", "Silver", "Diamond",
        "Protocol", "Network", "Swap", "Base", "Verse", "Matic", "Node", "Bit", "Block", "Ledger",
        "Cyber", "Mint", "Hash", "Yield", "DeFi", "Dao", "Asset", "Gem", "Crystal", "Flux",
        "Core", "Link", "Storm", "Wave", "Fire", "Ice", "Wind", "Earth", "Light", "Shadow"
    ];

    const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];

    const tokenName = `(AT) ${randomPrefix} ${randomSuffix}`;
    const tokenSymbol = `${randomPrefix.substring(0, 3).toUpperCase()}${randomSuffix.substring(0, 1).toUpperCase()}`;

    // Generate dynamic description
    const descriptiveAdjs = [
        "revolutionary", "next-generation", "cutting-edge", "innovative", "groundbreaking",
        "futuristic", "disruptive", "game-changing", "transformative", "powerful",
        "leading-edge", "advanced", "visionary", "state-of-the-art", "pioneering",
        "experimental", "ambitious", "dynamic", "progressive", "sophisticated"
    ];

    const assetTypes = [
        "digital asset", "token", "cryptocurrency", "blockchain project", "financial instrument",
        "DeFi solution", "crypto ecosystem", "web3 platform", "metaverse token", "digital currency",
        "automated test token", "test protocol", "demo asset", "proof-of-concept token"
    ];

    const benefits = [
        "designed for the future of finance", "with advanced security features",
        "built on a robust decentralized framework", "providing unmatched scalability",
        "offering seamless cross-chain compatibility", "that revolutionizes digital ownership",
        "enabling trustless transactions", "with built-in governance features",
        "featuring deflationary tokenomics", "with innovative staking rewards",
        "created for automated testing purposes", "designed to validate auction systems"
    ];

    const impacts = [
        "bridging traditional finance and the digital world", "empowering users with true ownership",
        "creating a more inclusive financial ecosystem", "solving real-world problems with blockchain technology",
        "democratizing access to global markets", "reducing transaction costs dramatically",
        "enabling new forms of digital collaboration", "accelerating the adoption of decentralized technologies",
        "redefining value creation in the digital age", "establishing a new paradigm for digital assets",
        "facilitating comprehensive testing scenarios", "ensuring robust auction mechanisms"
    ];

    const visions = [
        "Join our vibrant community today!", "Early adopters will benefit from our growing ecosystem.",
        "Be part of the financial revolution.", "The future of crypto starts here.",
        "Together we're building the next financial paradigm.", "Transparency and security are our core values.",
        "Designed by developers, for everyone.", "Where innovation meets practicality.",
        "Turning complex problems into simple solutions.", "Pushing the boundaries of what's possible in crypto.",
        "(AT) This token was generated for testing purposes.", "Testing the limits of automated token generation!"
    ];

    // Select random components for the description
    const randomAdj = descriptiveAdjs[Math.floor(Math.random() * descriptiveAdjs.length)];
    const randomAssetType = assetTypes[Math.floor(Math.random() * assetTypes.length)];
    const randomBenefit = benefits[Math.floor(Math.random() * benefits.length)];
    const randomImpact = impacts[Math.floor(Math.random() * impacts.length)];
    const randomVision = visions[Math.floor(Math.random() * visions.length)];

    // Construct the full description with (AT) identifier
    const randomDescription = `(AT) A ${randomAdj} ${randomAssetType} ${randomBenefit}. ${randomImpact}. ${randomVision}`;

    // Generate social links
    const socialLinks = generateSocialLinks(tokenName);

    // Extract keywords for Giphy search
    const potentialSearchTerms = [];

    if (randomBenefit.includes("deflationary")) potentialSearchTerms.push("money burning");
    if (randomBenefit.includes("governance")) potentialSearchTerms.push("voting");
    if (randomBenefit.includes("staking")) potentialSearchTerms.push("staking");
    if (randomAssetType.includes("metaverse")) potentialSearchTerms.push("metaverse");
    if (randomAssetType.includes("DeFi")) potentialSearchTerms.push("finance");

    // Add token-specific search terms
    potentialSearchTerms.push(`${randomPrefix.toLowerCase()}`);
    potentialSearchTerms.push(`${randomSuffix.toLowerCase()}`);
    potentialSearchTerms.push("cryptocurrency", "blockchain", "crypto", "digital", "future");

    const searchTerm = potentialSearchTerms[Math.floor(Math.random() * potentialSearchTerms.length)];

    let imageBuffer: Buffer;
    let imageExtension: string = 'svg';

    try {
        console.log(`Attempting to fetch Giphy content for: ${searchTerm}`);
        const giphyResult = await getGiphyContent(searchTerm, 25);

        // Decide whether to use a GIF or still image
        const useGif = Math.random() > 0.3; // 70% chance of using GIF

        if ((useGif && giphyResult.gifs.length > 0) || (!useGif && giphyResult.stills.length > 0)) {
            const imageUrl = useGif
                ? giphyResult.gifs[Math.floor(Math.random() * giphyResult.gifs.length)]
                : giphyResult.stills[Math.floor(Math.random() * giphyResult.stills.length)];

            console.log(`Fetching ${useGif ? 'GIF' : 'still image'} from: ${imageUrl}`);

            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error('Could not fetch image');

            const arrayBuffer = await response.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);

            // Detect file type from URL and buffer
            imageExtension = detectFileExtension(imageUrl, imageBuffer);

            console.log(`Successfully fetched ${useGif ? 'animated' : 'static'} image (${imageExtension})`);
        } else {
            throw new Error('No suitable images found on Giphy');
        }
    } catch (error) {
        console.log(`Giphy fetch failed, generating SVG meme: ${error.message}`);
        imageBuffer = generateSvgImage(tokenSymbol);
        imageExtension = 'svg';
    }

    return {
        name: tokenName,
        symbol: tokenSymbol,
        description: randomDescription,
        imageFile: imageBuffer,
        imageExtension,
        telegramLink: socialLinks.telegram,
        websiteLink: socialLinks.website,
        twitterLink: socialLinks.twitter
    };
}

/**
 * Generate test token data and upload to IPFS
 */
export async function generateAndUploadTestTokenData(): Promise<TestTokenData> {
    console.log("Generating comprehensive test token data...");

    // Check if Pinata is configured
    if (!isPinataConfigured()) {
        throw new Error("PINATA_PUBLIC_KEY environment variable not set or invalid. Cannot upload to IPFS. Please set a valid Pinata API key.");
    }

    const testData = await generateTestTokenData();

    if (!testData.imageFile) {
        throw new Error("Failed to generate test image");
    }

    try {
        console.log(`Uploading ${testData.imageExtension} image to IPFS...`);

        // Upload image to IPFS
        const timestamp = new Date().getTime();
        const filename = `token-${testData.symbol.toLowerCase()}-${timestamp}.${testData.imageExtension}`;
        const imageUrl = await uploadImageToPinata(testData.imageFile, filename);

        console.log(`Image uploaded successfully: ${imageUrl}`);

        // Upload metadata to IPFS
        console.log("Uploading metadata to IPFS...");
        const metadataUri = await uploadMetadataToPinata(
            testData.name,
            testData.symbol,
            testData.description,
            imageUrl
        );

        console.log(`Metadata uploaded successfully: ${metadataUri}`);

        testData.metadataUri = metadataUri;

        return testData;
    } catch (error) {
        console.error("Failed to upload to IPFS:", error);
        throw new Error(`IPFS upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Generate multiple test token data sets for bulk testing
 */
export async function generateMultipleTestTokens(count: number = 5): Promise<TestTokenData[]> {
    console.log(`Generating ${count} test tokens with diverse content...`);

    const tokens: TestTokenData[] = [];

    for (let i = 0; i < count; i++) {
        try {
            console.log(`\nGenerating test token ${i + 1}/${count}...`);
            const tokenData = await generateAndUploadTestTokenData();
            tokens.push(tokenData);

            // Add a small delay to avoid rate limiting
            if (i < count - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error(`Failed to generate test token ${i + 1}:`, error);
            // Continue with the next token instead of failing entirely
        }
    }

    console.log(`\nSuccessfully generated ${tokens.length}/${count} test tokens`);
    return tokens;
}

/**
 * Create a specific test token for a given theme
 */
export async function generateThemedTestToken(theme: string): Promise<TestTokenData> {
    console.log(`Generating themed test token for: ${theme}`);

    // Check if Pinata is configured
    if (!isPinataConfigured()) {
        throw new Error("PINATA_PUBLIC_KEY environment variable not set or invalid. Cannot upload to IPFS. Please set a valid Pinata API key.");
    }

    // Theme-specific configurations
    const themes: { [key: string]: { prefixes: string[], suffixes: string[], searchTerms: string[] } } = {
        'meme': {
            prefixes: ['Doge', 'Pepe', 'Shib', 'Meme', 'Bonk', 'Floki'],
            suffixes: ['Coin', 'Token', 'Inu', 'Meme', 'Moon'],
            searchTerms: ['doge', 'pepe', 'shiba', 'meme', 'funny']
        },
        'defi': {
            prefixes: ['Yield', 'Swap', 'Stake', 'Farm', 'Pool', 'Vault'],
            suffixes: ['Finance', 'Protocol', 'Yield', 'Farm', 'Swap'],
            searchTerms: ['finance', 'money', 'bank', 'gold', 'chart']
        },
        'gaming': {
            prefixes: ['Game', 'Play', 'Quest', 'Arena', 'Battle', 'Hero'],
            suffixes: ['Token', 'Coin', 'Quest', 'Game', 'Play'],
            searchTerms: ['gaming', 'play', 'controller', 'arcade', 'pixel']
        },
        'ai': {
            prefixes: ['AI', 'Neural', 'Cyber', 'Robot', 'Mind', 'Brain'],
            suffixes: ['AI', 'Bot', 'Mind', 'Neural', 'Tech'],
            searchTerms: ['robot', 'ai', 'tech', 'cyber', 'future']
        }
    };

    const themeConfig = themes[theme.toLowerCase()] || themes['meme'];

    // Generate base token data
    const testData = await generateTestTokenData();

    // Override with themed content
    const themedPrefix = themeConfig.prefixes[Math.floor(Math.random() * themeConfig.prefixes.length)];
    const themedSuffix = themeConfig.suffixes[Math.floor(Math.random() * themeConfig.suffixes.length)];
    const themedSearchTerm = themeConfig.searchTerms[Math.floor(Math.random() * themeConfig.searchTerms.length)];

    testData.name = `(AT) ${themedPrefix} ${themedSuffix}`;
    testData.symbol = `${themedPrefix.substring(0, 3).toUpperCase()}${themedSuffix.substring(0, 1).toUpperCase()}`;
    testData.description = `(AT) A ${theme}-focused ${testData.description.split('A ')[1]}`;

    // Try to get themed image
    try {
        const giphyResult = await getGiphyContent(themedSearchTerm, 20);
        if (giphyResult.gifs.length > 0) {
            const imageUrl = giphyResult.gifs[Math.floor(Math.random() * giphyResult.gifs.length)];
            const response = await fetch(imageUrl);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                testData.imageFile = Buffer.from(arrayBuffer);
                testData.imageExtension = detectFileExtension(imageUrl, testData.imageFile);
            }
        }
    } catch (error) {
        console.log(`Themed image fetch failed, using original: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Upload to IPFS
    if (testData.imageFile) {
        const timestamp = new Date().getTime();
        const filename = `${theme}-token-${testData.symbol.toLowerCase()}-${timestamp}.${testData.imageExtension}`;
        const imageUrl = await uploadImageToPinata(testData.imageFile, filename);
        const metadataUri = await uploadMetadataToPinata(
            testData.name,
            testData.symbol,
            testData.description,
            imageUrl
        );
        testData.metadataUri = metadataUri;
    }

    return testData;
} 