import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { logDeletionProposed } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorDeletion(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  const deletionProposals = (
    await votingV2.queryFilter(
      votingV2.filters.SignaledRequestsAsSpamForDeletion(),
      params.blockRange.start,
      params.blockRange.end
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
}
