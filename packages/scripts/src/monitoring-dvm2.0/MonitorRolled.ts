import { delay, Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { checkEndBlockVotingRound, getRequestId, initCommonEnvVars, updateBlockRange } from "./common";
import { logRolled } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);

  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

    // Check rolled votes among pending requests only if a new voting round has started compared to the last block checked.
    // It is assumed that checked block range does not exceed voting round length in order not to miss any rolled votes.
    const endBlockRoundStatus = await checkEndBlockVotingRound(params, votingV2);
    if (endBlockRoundStatus.isNew) {
      const pendingRequests = await votingV2.getPendingRequests({ blockTag: params.endingBlock });
      const newRequests = await votingV2.queryFilter(
        votingV2.filters.PriceRequestAdded(null, endBlockRoundStatus.roundId, null)
      );
      const rolledRequests = pendingRequests.filter((request) => {
        const requestId = getRequestId(request.identifier, request.time, request.ancillaryData);
        return !newRequests.some(
          (newRequest) =>
            getRequestId(newRequest.args.identifier, newRequest.args.time, newRequest.args.ancillaryData) === requestId
        );
      });
      rolledRequests.forEach((request) => {
        logRolled(logger, request, endBlockRoundStatus.roundId);
      });
    }

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
