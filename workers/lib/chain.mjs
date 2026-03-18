/**
 * chain.mjs — On-chain NFT minting/revocation via ethers.js
 *
 * Same logic as server/lib/chain.mjs but reads config from env bindings
 * instead of process.env.
 */

import { ethers } from "ethers";

const ABI = [
  "function mint(address to, string calldata ailId, string calldata uri) external returns (uint256 tokenId)",
  "function revoke(uint256 tokenId) external",
  "function getTokenId(string calldata ailId) external view returns (uint256)",
  "function isRegistered(string calldata ailId) external view returns (bool)",
  "event AILMinted(uint256 indexed tokenId, string indexed ailId, address indexed owner)",
];

function getContract(env) {
  const rpc = env.CHAIN_RPC_URL;
  const privKey = env.CHAIN_PRIVATE_KEY;
  const address = env.NFT_CONTRACT_ADDRESS;

  if (!rpc || !privKey || !address) return null;

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(privKey, provider);
    return { contract: new ethers.Contract(address, ABI, wallet), wallet };
  } catch (err) {
    console.error("[chain] init failed:", err.message);
    return null;
  }
}

export function isChainEnabled(env) {
  return !!(env.CHAIN_RPC_URL && env.CHAIN_PRIVATE_KEY && env.NFT_CONTRACT_ADDRESS);
}

export async function mintAgent(env, ailId, toAddress, metadataUri) {
  const chain = getContract(env);
  if (!chain) return null;

  const to = toAddress || (await chain.wallet.getAddress());

  try {
    const tx = await chain.contract.mint(to, ailId, metadataUri);
    const receipt = await tx.wait(1);

    const iface = new ethers.Interface([
      "event AILMinted(uint256 indexed tokenId, string indexed ailId, address indexed owner)",
    ]);

    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "AILMinted") {
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch { /* not this log */ }
    }

    return { tokenId, txHash: receipt.hash };
  } catch (err) {
    console.error(`[chain] mint failed for ${ailId}:`, err.message);
    return null;
  }
}

export async function revokeAgent(env, tokenId) {
  const chain = getContract(env);
  if (!chain || tokenId == null) return null;

  try {
    const tx = await chain.contract.revoke(BigInt(tokenId));
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash };
  } catch (err) {
    console.error(`[chain] revoke failed for tokenId ${tokenId}:`, err.message);
    return null;
  }
}
