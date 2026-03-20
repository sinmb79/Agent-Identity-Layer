const fs = require("fs");

const DEPLOYMENTS_SCHEMA_VERSION = 3;
const REQUIRED_NETWORK_KEYS = ["base-sepolia", "base"];
const CONTRACT_KEYS = ["identity", "achievement"];

function emptyContractDeployment() {
  return {
    address: "",
    deployer: "",
    txHash: "",
    deployedAt: "",
  };
}

function emptyNetworkDeployment() {
  return {
    identity: emptyContractDeployment(),
    achievement: emptyContractDeployment(),
  };
}

function normalizeNetworkDeployment(value = {}) {
  const normalized = emptyNetworkDeployment();

  if (value.identity || value.achievement) {
    for (const contractKey of CONTRACT_KEYS) {
      normalized[contractKey] = {
        ...emptyContractDeployment(),
        ...(value[contractKey] || {}),
      };
    }
    return normalized;
  }

  if ("address" in value || "deployer" in value || "txHash" in value || "deployedAt" in value) {
    normalized.identity = {
      ...emptyContractDeployment(),
      ...value,
    };
  }

  return normalized;
}

function normalizeDeployments(raw = {}) {
  if (raw.schemaVersion === DEPLOYMENTS_SCHEMA_VERSION && raw.networks) {
    const networks = {};
    for (const [networkName, value] of Object.entries(raw.networks)) {
      networks[networkName] = normalizeNetworkDeployment(value);
    }
    return {
      schemaVersion: DEPLOYMENTS_SCHEMA_VERSION,
      networks,
    };
  }

  const rawNetworks = raw.networks && typeof raw.networks === "object"
    ? raw.networks
    : raw;

  const networks = {};
  for (const [networkName, value] of Object.entries(rawNetworks || {})) {
    if (!value || typeof value !== "object") continue;
    networks[networkName] = normalizeNetworkDeployment(value);
  }

  return {
    schemaVersion: DEPLOYMENTS_SCHEMA_VERSION,
    networks,
  };
}

function ensureRequiredNetworks(deployments) {
  for (const networkName of REQUIRED_NETWORK_KEYS) {
    if (!deployments.networks[networkName]) {
      deployments.networks[networkName] = emptyNetworkDeployment();
    } else {
      deployments.networks[networkName] = normalizeNetworkDeployment(deployments.networks[networkName]);
    }
  }

  return deployments;
}

function readDeployments(deploymentsPath) {
  const rawDeployments = fs.existsSync(deploymentsPath)
    ? JSON.parse(fs.readFileSync(deploymentsPath, "utf8"))
    : {};

  return ensureRequiredNetworks(normalizeDeployments(rawDeployments));
}

function writeDeployments(deploymentsPath, deployments) {
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
}

function getContractDeployment(deployments, networkName, contractKey) {
  return deployments.networks?.[networkName]?.[contractKey] ?? null;
}

module.exports = {
  DEPLOYMENTS_SCHEMA_VERSION,
  emptyContractDeployment,
  emptyNetworkDeployment,
  normalizeDeployments,
  ensureRequiredNetworks,
  readDeployments,
  writeDeployments,
  getContractDeployment,
};
