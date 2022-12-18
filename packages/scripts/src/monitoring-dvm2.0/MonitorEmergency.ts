import { delay, Logger } from "@uma/financial-templates-lib";
import { EmergencyProposerEthers } from "@uma/contracts-node";
import { initCommonEnvVars, updateBlockRange } from "./common";
import { logEmergencyProposal } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);

  const emergencyProposer = await getContractInstanceByUrl<EmergencyProposerEthers>(
    "EmergencyProposer",
    params.jsonRpcUrl
  );

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

    const emergencyProposals = (
      await emergencyProposer.queryFilter(
        emergencyProposer.filters.EmergencyTransactionsProposed(),
        params.startingBlock,
        params.endingBlock
      )
    ).map((event) => ({
      tx: event.transactionHash,
      id: event.args.id.toString(),
      sender: event.args.sender,
    }));
    emergencyProposals.forEach((proposal) => {
      logEmergencyProposal(logger, proposal, params.chainId);
    });
    if (params.pollingDelay === 0) break;
    await delay(Number(params.pollingDelay));
    await updateBlockRange(params);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
