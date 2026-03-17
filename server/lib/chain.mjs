/**
 * chain.mjs — On-chain NFT minting/revocation via ethers.js
 *
 * Reads configuration from environment variables:
 *   CHAIN_RPC_URL        — JSON-RPC endpoint (Alchemy or public)
 *   CHAIN_PRIVATE_KEY    — Minter wallet private key (hex, 0x-prefixed)
 *   NFT_CONTRACT_ADDRESS — Deployed AILIdentity contract address
 *   AIL_BASE_URL         — Public server URL (used to build metadata URIs)
 *
 * If any required variable is missing, all chain operations become no-ops
 * so the server works in "off-chain only" mode (JWT still issued normally).
 */

import { ethers } from "ethers";

// Minimal ABI — only the functions the server needs
const ABI = [
  "function mint(address to, string calldata ailId, string calldata uri) external returns (uint256 tokenId)",
  "function revoke(uint256 tokenId) external",
  "function getTokenId(string calldata ailId) external view returns (uint256)",
  "function isRegistered(string calldata ailId) external view returns (bool)",
];

let _contract = null;
let _wallet   = null;
let _enabled  = false;

function init() {
  const rpc      = process.env.CHAIN_RPC_URL;
  const privKey  = process.env.CHAIN_PRIVATE_KEY;
  const address  = process.env.NFT_CONTRACT_ADDRESS;

  if (!rpc || !privKey || !address) {
    return; // off-chain mode
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    _wallet   = new ethers.Wallet(privKey, provider);
    _contract = new ethers.Contract(address, ABI, _wallet);
    _enabled  = true;
  } catch (err) {
    console.error("[chain] init failed:", err.message);
  }
}

init();

/**
 * Returns true if on-chain minting is configured and ready.
 */
export function isChainEnabled() {
  return _enabled;
}

/**
 * Mint an AILIdentity NFT for a newly registered agent.
 *
 * @param {string} ailId        — e.g. "AIL-2026-00001"
 * @param {string} toAddress    — Ethereum address to receive the NFT
 *                                (defaults to minter wallet if not provided)
 * @param {string} metadataUri  — ERC-721 tokenURI (off-chain metadata URL)
 * @returns {{ tokenId: string, txHash: string } | null}
 */
export async function mintAgent(ailId, toAddress, metadataUri) {
  if (!_enabled) return null;

  const to = toAddress || (await _wallet.getAddress());

  try {
    const tx = await _contract.mint(to, ailId, metadataUri);
    const receipt = await tx.wait(1); // wait for 1 confirmation

    // Parse AILMinted event to get tokenId
    const iface = new ethers.Interface([
      "event AILMinted(uint256 indexed tokenId, string indexed ailId, address indexed owner)",
    ]);

    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "AILMinted") {
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch {
        // not this log
      }
    }

    return { tokenId, txHash: receipt.hash };
  } catch (err) {
    // Non-fatal — log and return null so registration still succeeds
    console.error(`[chain] mint failed for ${ailId}:`, err.message);
    return null;
  }
}

/**
 * Revoke (burn) an AILIdentity NFT on chain.
 *
 * @param {string|number} tokenId — NFT token ID
 * @returns {{ txHash: string } | null}
 */
export async function revokeAgent(tokenId) {
  if (!_enabled || tokenId == null) return null;

  try {
    const tx = await _contract.revoke(BigInt(tokenId));
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash };
  } catch (err) {
    console.error(`[chain] revoke failed for tokenId ${tokenId}:`, err.message);
    return null;
  }
}
