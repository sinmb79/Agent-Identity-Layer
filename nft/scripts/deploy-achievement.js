/**
 * Deploy AILAchievement ERC-721 contract.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-achievement.js --network base-sepolia
 *   npx hardhat run scripts/deploy-achievement.js --network base
 */

const { ethers, network } = require("hardhat");
const path = require("path");
const {
  readDeployments,
  writeDeployments,
  getContractDeployment,
} = require("./deployments");

async function main() {
  const networkName = network.name;
  console.log("\n========================================");
  console.log(`Deploying AILAchievement on ${networkName}`);
  console.log("========================================");

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance  : ${ethers.formatEther(balance)} native token`);

  if (balance === 0n) {
    console.error("\nDeployer has zero balance. Fund the wallet first.");
    process.exit(1);
  }

  console.log("\nDeploying...");
  const AILAchievement = await ethers.getContractFactory("AILAchievement");
  const contract = await AILAchievement.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash ?? "";

  console.log("\nContract deployed");
  console.log(`  Address : ${address}`);
  console.log(`  Tx hash : ${txHash}`);

  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deployments = readDeployments(deploymentsPath);

  deployments.networks[networkName].achievement = {
    address,
    deployer: deployer.address,
    txHash,
    deployedAt: new Date().toISOString(),
  };

  writeDeployments(deploymentsPath, deployments);
  console.log(`\nSaved deployment metadata to ${deploymentsPath}`);

  const identityAddress = getContractDeployment(deployments, networkName, "identity")?.address;

  console.log("\nNext steps");
  if (identityAddress) {
    console.log(`1. Transfer minter role:         npx hardhat run scripts/set-achievement-minter.js --network ${networkName}`);
  } else {
    console.log("1. Identity deployment not found yet. Deploy AILIdentity before wiring minter roles.");
  }
  console.log(`2. Verify source:               npx hardhat verify --network ${networkName} ${address} ${deployer.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
