require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const API_KEY     = process.env.ALCHEMY_API_KEY    ?? "";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

// Only include accounts if the private key looks valid (32-byte hex)
const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/.test(PRIVATE_KEY);
const accounts   = isValidKey ? [PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },

  networks: {
    // ── Testnets (free, no real money) ──────────────────────────────────
    "base-sepolia": {
      url:      `https://base-sepolia.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  84532,
    },
    "polygon-amoy": {
      url:      `https://polygon-amoy.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  80002,
    },
    "eth-sepolia": {
      url:      `https://eth-sepolia.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  11155111,
    },

    // ── Mainnets ─────────────────────────────────────────────────────────
    "base": {
      url:      `https://base-mainnet.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  8453,
    },
    "ethereum": {
      url:      `https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  1,
    },
    "polygon": {
      url:      `https://polygon-mainnet.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  137,
    },
    "bnb": {
      url:      "https://bsc-dataseed1.binance.org/",
      accounts,
      chainId:  56,
    },
    "worldchain": {
      url:      `https://worldchain-mainnet.g.alchemy.com/v2/${API_KEY}`,
      accounts,
      chainId:  480,
    },
  },

  etherscan: {
    apiKey: {
      base:           process.env.BASESCAN_API_KEY     ?? "",
      "base-sepolia": process.env.BASESCAN_API_KEY     ?? "",
      mainnet:        process.env.ETHERSCAN_API_KEY    ?? "",
      "eth-sepolia":  process.env.ETHERSCAN_API_KEY    ?? "",
      polygon:        process.env.POLYGONSCAN_API_KEY  ?? "",
      "polygon-amoy": process.env.POLYGONSCAN_API_KEY  ?? "",
      bsc:            process.env.BSCSCAN_API_KEY      ?? "",
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL:     "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL:     "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};
