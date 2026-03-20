/**
 * Transfer achievement minter role to the AIL server wallet.
 *
 * Set SERVER_WALLET in .env before running.
 *
 * Usage:
 *   npx hardhat run scripts/set-achievement-minter.js --network base-sepolia
 *   npx hardhat run scripts/set-achievement-minter.js --network base
 */

const { ethers, network } = require("hardhat");
const path = require("path");
const { readDeployments, getContractDeployment } = require("./deployments");

async function main() {
  const networkName = network.name;
  const serverWallet = process.env.SERVER_WALLET;

  if (!serverWallet) {
    console.error("Set SERVER_WALLET=<address> in .env");
    process.exit(1);
  }

  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deployments = readDeployments(deploymentsPath);
  const contractAddress = getContractDeployment(deployments, networkName, "achievement")?.address;

  if (!contractAddress) {
    console.error(`No achievement deployment found for network: ${networkName}`);
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  const AILAchievement = await ethers.getContractAt("AILAchievement", contractAddress, signer);

  console.log(`\nSetting achievement minter on ${networkName}...`);
  console.log(`  Contract : ${contractAddress}`);
  console.log(`  New minter: ${serverWallet}`);

  const tx = await AILAchievement.setMinter(serverWallet);
  await tx.wait();

  console.log(`\nMinter updated. Tx: ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
