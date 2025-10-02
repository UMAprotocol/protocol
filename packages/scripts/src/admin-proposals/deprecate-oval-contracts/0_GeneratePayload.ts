// This script creates a Safe payload to deprecate Oval lock contracts by setting their lock window to 0 and renouncing ownership.
// The generated JSON file can be imported into the Gnosis Safe Transaction Builder UI.
// Export following environment variables:
// - TARGET_CONTRACTS: Comma-separated list of contract addresses to deprecate (e.g., "0x123...,0x456...")
// - SAFE_ADDRESS: The Gnosis Safe multisig address that will execute these transactions
// - NODE_URL_1: Mainnet RPC URL (optional, only needed for fork testing)
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/0_GeneratePayload.ts --network mainnet
// Note: use localhost for the forked network testing

import fs from "fs";
import hre from "hardhat";
import path from "path";
import {
  appendTxToSafePayload,
  baseSafePayload,
  getContractMethod,
  simulateSafePayload,
} from "../../utils/gnosisPayload";

const TARGET_CONTRACTS = process.env.TARGET_CONTRACTS?.split(",") || [];
if (TARGET_CONTRACTS.length === 0) {
  throw new Error("TARGET_CONTRACTS environment variable is required (comma-separated addresses)");
}

const CONTRACT_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "newLockWindow", type: "uint256" }],
    name: "setLockWindow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  {
    inputs: [],
    name: "lockWindow",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

async function main() {
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  // Validate we're on Ethereum mainnet (chainId 1)
  if (chainId !== 1 && hre.network.name !== "localhost") {
    throw new Error(`This script is intended for Ethereum mainnet (chainId 1), but detected chainId ${chainId}`);
  }

  // Get the Safe address from environment variable
  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    throw new Error("SAFE_ADDRESS environment variable is required");
  }

  // Create the base Safe payload
  let safePayload = baseSafePayload(
    1, // Ethereum mainnet
    "Deprecate Oval Contracts",
    "Set lock window to 0 and renounce ownership on contracts",
    safeAddress
  );

  // For each contract, add setLockWindow(0) and renounceOwnership transactions
  for (const contractAddress of TARGET_CONTRACTS) {
    // Transaction 1: setLockWindow(0)
    safePayload = appendTxToSafePayload(
      safePayload,
      contractAddress,
      getContractMethod(CONTRACT_ABI, "setLockWindow"),
      {
        newLockWindow: "0",
      }
    );

    // Transaction 2: renounceOwnership
    safePayload = appendTxToSafePayload(
      safePayload,
      contractAddress,
      getContractMethod(CONTRACT_ABI, "renounceOwnership"),
      {}
    );
  }

  // Save the payload to file
  const outDir = path.resolve(__dirname, "../../../out");
  fs.mkdirSync(outDir, { recursive: true });
  const savePath = path.join(outDir, `${path.basename(__dirname)}_${chainId}.json`);
  fs.writeFileSync(savePath, JSON.stringify(safePayload, null, 4));

  console.log(`Safe payload for ${safeAddress} saved to ${savePath}`);
  console.log(`Total transactions: ${safePayload.transactions.length}`);

  // Only spoof the execution on a forked network
  if (hre.network.name === "localhost") {
    console.log("Simulating Safe payload execution on forked network...");
    const safeVersion = "1.3.0";
    await simulateSafePayload(hre.ethers.provider, safePayload, safeVersion);
    console.log("Simulation completed successfully!");
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
