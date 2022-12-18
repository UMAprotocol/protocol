import { delay, Logger } from "@uma/financial-templates-lib";
import { GovernorV2Ethers } from "@uma/contracts-node";
import { initCommonEnvVars, updateBlockRange } from "./common";
import { logGovernanceProposal } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);

  const governorV2 = await getContractInstanceByUrl<GovernorV2Ethers>("GovernorV2", params.jsonRpcUrl);

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

    const governanceProposals = (
      await governorV2.queryFilter(governorV2.filters.NewProposal(), params.startingBlock, params.endingBlock)
    ).map((event) => ({
      tx: event.transactionHash,
      id: event.args.id.toString(),
    }));
    governanceProposals.forEach((proposal) => {
      logGovernanceProposal(logger, proposal, params.chainId);
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
