// This script verifies that the lock contracts have been correctly deprecated.
// It checks that lockWindow is set to 0 and ownership has been renounced (transferred to 0x0).
// It can be run on a local hardhat node fork of mainnet or directly on mainnet to verify.
// To run this on localhost first fork mainnet into a local hardhat node by running:
// NODE_URL_1=<MAINNET-NODE-URL> yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/1_Verify.ts --network localhost
// To run on mainnet:
// NODE_URL_1=<MAINNET-NODE-URL> yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/1_Verify.ts --network mainnet

import { constants as ethersConstants } from "ethers";
import { strict as assert } from "assert";
import hre from "hardhat";
const { ethers } = hre;

// Contract addresses to verify
const TARGET_CONTRACTS = [
  "0xc47641ed51f73A82C62Ba439d90096bccC376fe8",
  "0xCf17f459F4D1D9e6fb5aa5013Bd2D7EB6083bd45",
  "0x4fC22E5f89891B6bd00d554B6250503d38EE5E4D",
  "0xE2380c199F07e78012c6D0b076A4137E6D1Ba022",
  "0x171b10e16223F86500D558D426Bf4fa5EF280087",
];

// Contract ABI
const LOCK_CONTRACT_ABI = [
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
  console.log("Verifying lock contract deprecation...\n");

  for (const contractAddress of TARGET_CONTRACTS) {
    console.log(`Checking contract: ${contractAddress}`);

    // Connect to the contract
    const contract = new ethers.Contract(contractAddress, LOCK_CONTRACT_ABI, ethers.provider);

    // Verify lockWindow is 0
    const lockWindow = await contract.lockWindow();
    assert(lockWindow.eq(0), `lockWindow mismatch for ${contractAddress}: expected 0, got ${lockWindow.toString()}`);
    console.log(`  ✓ lockWindow = 0`);

    // Verify owner is 0x0 (ownership renounced)
    const owner = await contract.owner();
    assert(
      owner === ethersConstants.AddressZero,
      `owner mismatch for ${contractAddress}: expected ${ethersConstants.AddressZero}, got ${owner}`
    );
    console.log(`  ✓ owner = ${ethersConstants.AddressZero} (renounced)\n`);
  }

  console.log("All contracts verified successfully!");
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
