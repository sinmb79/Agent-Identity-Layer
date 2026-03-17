/**
 * Transfer minter role to the AIL server wallet.
 *
 * Set SERVER_WALLET in .env before running.
 *
 * Usage:
 *   npx hardhat run scripts/set-minter.js --network base-sepolia
 *   npx hardhat run scripts/set-minter.js --network base
 */

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const networkName = network.name;
  const serverWallet = process.env.SERVER_WALLET;

  if (!serverWallet) {
    console.error("✗ Set SERVER_WALLET=<address> in .env");
    process.exit(1);
  }

  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    console.error("✗ deployments.json not found. Run deploy.js first.");
    process.exit(1);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const contractAddress = deployments[networkName]?.address;

  if (!contractAddress) {
    console.error(`✗ No deployment found for network: ${networkName}`);
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  const AILIdentity = await ethers.getContractAt("AILIdentity", contractAddress, signer);

  console.log(`\nSetting minter on ${networkName}...`);
  console.log(`  Contract : ${contractAddress}`);
  console.log(`  New minter: ${serverWallet}`);

  const tx = await AILIdentity.setMinter(serverWallet);
  await tx.wait();

  console.log(`\n✓ Minter updated. Tx: ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
