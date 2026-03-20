/**
 * Deploy AILIdentity ERC-721 contract.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network base-sepolia
 *   npx hardhat run scripts/deploy.js --network base
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENTS_SCHEMA_VERSION = 2;
const REQUIRED_NETWORK_KEYS = ["base-sepolia", "base"];

function emptyDeployment() {
  return {
    address: "",
    deployer: "",
    txHash: "",
    deployedAt: "",
  };
}

function normalizeDeployments(raw = {}) {
  if (raw.schemaVersion === DEPLOYMENTS_SCHEMA_VERSION && raw.networks) {
    return raw;
  }

  const networks = {};
  for (const [networkName, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    if (!("address" in value || "deployer" in value || "txHash" in value || "deployedAt" in value)) continue;
    networks[networkName] = {
      ...emptyDeployment(),
      ...value,
    };
  }

  return {
    schemaVersion: DEPLOYMENTS_SCHEMA_VERSION,
    networks,
  };
}

function ensureRequiredNetworks(deployments) {
  for (const networkName of REQUIRED_NETWORK_KEYS) {
    if (!deployments.networks[networkName]) {
      deployments.networks[networkName] = emptyDeployment();
    }
  }
  return deployments;
}

async function main() {
  const networkName = network.name;
  console.log("\n========================================");
  console.log(`Deploying AILIdentity on ${networkName}`);
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
  const AILIdentity = await ethers.getContractFactory("AILIdentity");
  const contract = await AILIdentity.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash ?? "";

  console.log("\nContract deployed");
  console.log(`  Address : ${address}`);
  console.log(`  Tx hash : ${txHash}`);

  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const rawDeployments = fs.existsSync(deploymentsPath)
    ? JSON.parse(fs.readFileSync(deploymentsPath, "utf8"))
    : {};
  const deployments = ensureRequiredNetworks(normalizeDeployments(rawDeployments));

  deployments.networks[networkName] = {
    address,
    deployer: deployer.address,
    txHash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nSaved deployment metadata to ${deploymentsPath}`);

  console.log("\nNext steps");
  console.log(`1. Transfer minter role: npx hardhat run scripts/set-minter.js --network ${networkName}`);
  console.log(`2. Verify source:       npx hardhat verify --network ${networkName} ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
