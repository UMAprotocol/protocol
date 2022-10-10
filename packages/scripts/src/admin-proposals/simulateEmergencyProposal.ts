// Description:
// - Simulate voting affirmatively on any pending Admin Proposals
import { EmergencyProposerEthers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";
import { increaseEvmTime } from "../utils/utils";

require("dotenv").config();
const hre = require("hardhat");

async function simulateEmergencyProposal() {
  const emergencyProposerAddress = process.env["EMERGENCY_PROPOSER_ADDRESS"];
  const emergencyExecutorAddress = process.env["EMERGENCY_EXECUTOR"];
  if (!emergencyExecutorAddress) throw new Error("Missing EMERGENCY_EXECUTOR env variable");
  if (!emergencyProposerAddress) throw new Error("Missing EMERGENCY_PROPOSER_ADDRESS env variable");

  console.log("\n🚨 Simulating Emergency Proposals");

  const emergencyProposer = await getContractInstance<EmergencyProposerEthers>(
    "EmergencyProposer",
    emergencyProposerAddress
  );

  const proposed = await emergencyProposer.queryFilter(emergencyProposer.filters.EmergencyTransactionsProposed());
  const executed = await emergencyProposer.queryFilter(emergencyProposer.filters.EmergencyProposalExecuted());
  const proposalsToProcess = proposed.filter((p) => !executed.some((e) => e.args.id.eq(p.args.id)));

  if (proposalsToProcess.length === 0) console.log("No proposals to process");

  const executorSigner = await hre.ethers.getSigner(emergencyExecutorAddress);

  for (const emergencyProposal of proposalsToProcess) {
    const proposalId = emergencyProposal.args.id;
    const expiryTime = emergencyProposal.args.expiryTime;
    const currentTime = await emergencyProposer.getCurrentTime();
    if (currentTime.lt(expiryTime)) {
      await increaseEvmTime(expiryTime.sub(currentTime).toNumber());
    }
    console.log(`Executing proposal ${proposalId}`);
    await emergencyProposer.connect(executorSigner).executeEmergencyProposal(proposalId);
  }
}

function main() {
  const startTime = Date.now();
  simulateEmergencyProposal()
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

module.exports = { simulateEmergencyProposal };
