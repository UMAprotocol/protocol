// Description:
// - Executes specific approved Admin proposal, compatible with DVM2.0

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - This script should be run after any Admin proposal UMIP script against a local Mainnet fork. It allows the tester
//   to simulate what would happen if the proposal were to pass and to verify that contract state changes as expected.
// - This script can use following environment variables:
//   - NODE_URL_1 used to connect to the Ethereum network.
//   - MNEMONIC used to execute transactions. If not provided, the first hardhat signer will be used.
//   - DVM_VERSION used to determine which governor contract will be used. Allowed values are 1 and 2 (defaulting to 2
//     if no DVM_VERSION is provided).
//   - PROPOSAL_ID used to determine which proposal to execute. If not provided defaults to the last proposal.
//   - MULTICALL set to 1 if all proposal transactions should be executed through Multicall2 contract.
//   - TRACE set to 1 if the simulated execution transactions should be traced.
// - Run with hardhat (only mainnet and localhost networks are supported):
//   yarn hardhat run ./src/admin-proposals/executeProposalV2.ts --network localhost

import { strict as assert } from "assert";
import { Signer } from "ethers";
import hre from "hardhat";
import { GovernorEthers, GovernorV2Ethers, Multicall2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";

const { ethers } = hre;

require("dotenv").config();
async function executeProposalV2(): Promise<void> {
  assert((await ethers.provider.getNetwork()).chainId === 1, "Can execute proposals only on mainnet");
  assert(process.env.TRACE !== "1" || hre.network.name === "localhost", "Tracing available only for forked network");

  const executorSigner =
    process.env.MNEMONIC !== undefined
      ? (ethers.Wallet.fromMnemonic(process.env.MNEMONIC).connect(ethers.provider) as Signer)
      : ((await ethers.getSigners())[0] as Signer);
  const executorAddress = await executorSigner.getAddress();

  // Methods used in this script are compatible for both Governor and GovernorV2 that is selected by DVM_VERSION.
  const dvmVersion = process.env.DVM_VERSION !== undefined ? Number(process.env.DVM_VERSION) : 2;
  let governor: GovernorEthers | GovernorV2Ethers;
  if (dvmVersion === 2) {
    governor = await getContractInstance<GovernorV2Ethers>("GovernorV2");
  } else if (dvmVersion === 1) {
    governor = await getContractInstance<GovernorEthers>("Governor");
  } else {
    throw new Error("Invalid DVM version");
  }

  // If PROPOSAL_ID is not provided use the latest proposal.
  const proposalId =
    process.env.PROPOSAL_ID !== undefined ? Number(process.env.PROPOSAL_ID) : Number(await governor.numProposals()) - 1;
  console.group(`\n📢 Executing Governor Proposal ${proposalId} on DVM version ${dvmVersion} from ${executorAddress}`);
  const proposal = await governor.getProposal(proposalId.toString());

  if (process.env.MULTICALL === "1") {
    console.log("Submitting proposal execution with multicall");
    const calls = [];
    for (let j = 0; j < proposal.transactions.length; j++) {
      console.log(`- Aggregating transaction #${j + 1} from proposal #${proposalId}`);
      calls.push({
        target: governor.address,
        callData: governor.interface.encodeFunctionData("executeProposal", [proposalId, j]),
      });
    }
    const multicall = await getContractInstance<Multicall2Ethers>("Multicall2");
    const txn = await multicall.connect(executorSigner).aggregate(calls);
    await txn.wait();
    console.log(`    - Success, receipt: ${txn.hash}`);
    // Note that forked Hardhat node might crash if there are too many traces.
    if (process.env.TRACE === "1") await hre.run("trace", { hash: txn.hash });
  } else {
    for (let j = 0; j < proposal.transactions.length; j++) {
      console.log(`- Submitting transaction #${j + 1} from proposal #${proposalId}`);
      const txn = await governor.connect(executorSigner).executeProposal(proposalId, j);
      await txn.wait();
      console.log(`    - Success, receipt: ${txn.hash}`);
      if (process.env.TRACE === "1") await hre.run("trace", { hash: txn.hash });
    }
  }

  console.log("\n😇 Success!");
}

function main() {
  const startTime = Date.now();
  executeProposalV2()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}

if (require.main === module) {
  main();
}
