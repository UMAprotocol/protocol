import { delay, Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { initCommonEnvVars, updateBlockRange } from "./common";
import { logDeletionProposed } from "./MonitorLogger";
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

    const deletionProposals = (
      await votingV2.queryFilter(
        votingV2.filters.SignaledRequestsAsSpamForDeletion(),
        params.startingBlock,
        params.endingBlock
      )
    ).map((event) => ({
      tx: event.transactionHash,
      proposalId: event.args.proposalId.toString(),
      sender: event.args.sender,
      spamRequestIndices: event.args.spamRequestIndices,
    }));
    deletionProposals.forEach((proposal) => {
      logDeletionProposed(logger, proposal, params.chainId);
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
