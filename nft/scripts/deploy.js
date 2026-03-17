/**
 * Deploy AILIdentity ERC-721 contract.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network base-sepolia   # testnet
 *   npx hardhat run scripts/deploy.js --network base           # mainnet
 *   npx hardhat run scripts/deploy.js --network polygon
 *   npx hardhat run scripts/deploy.js --network bnb
 *   npx hardhat run scripts/deploy.js --network worldchain
 */

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const networkName = network.name;
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Deploying AILIdentity → ${networkName}`);
  console.log(`══════════════════════════════════════════`);

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeployer : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance  : ${ethers.formatEther(balance)} native token`);

  if (balance === 0n) {
    console.error("\n✗ Deployer has zero balance. Fund the wallet first.");
    process.exit(1);
  }

  // Deploy — set deployer as initial minter.
  // After deployment, call setMinter(<server_wallet>) to hand minting to the server.
  console.log(`\nDeploying...`);
  const AILIdentity = await ethers.getContractFactory("AILIdentity");
  const contract    = await AILIdentity.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const txHash  = contract.deploymentTransaction()?.hash;

  console.log(`\n✓ Contract deployed`);
  console.log(`  Address : ${address}`);
  console.log(`  Tx hash : ${txHash}`);

  // ── Save to deployments.json ──────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }

  deployments[networkName] = {
    address,
    deployer: deployer.address,
    txHash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\n✓ Saved to deployments.json`);

  // ── Next steps ────────────────────────────────────────────────────────
  const envKey = `CONTRACT_${networkName.toUpperCase().replace(/-/g, "_")}`;
  console.log(`\n── Next steps ──────────────────────────────`);
  console.log(`1. Add to server .env:`);
  console.log(`   ${envKey}=${address}`);
  console.log(`\n2. Transfer minter role to server wallet:`);
  console.log(`   npx hardhat run scripts/set-minter.js --network ${networkName}`);
  console.log(`\n3. (Optional) Verify contract source on explorer:`);
  console.log(`   npx hardhat verify --network ${networkName} ${address} <minter_address>`);
  console.log(`────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
