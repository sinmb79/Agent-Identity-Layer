#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

if [[ ! -f .env.mainnet ]]; then
  echo "Missing nft/.env.mainnet template."
  exit 1
fi

cp .env.mainnet .env
echo "Loaded .env.mainnet into .env"

npx hardhat run scripts/deploy.js --network base
npx hardhat run scripts/set-minter.js --network base

echo
echo "Verify on Basescan after deployment:"
echo "npx hardhat verify --network base <CONTRACT_ADDRESS>"
