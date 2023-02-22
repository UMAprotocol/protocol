import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { logDeleted } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorDeletion(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const deletedRequests = (
    await votingV2.queryFilter(votingV2.filters.RequestDeleted(), params.blockRange.start, params.blockRange.end)
  ).map((event) => ({
    tx: event.transactionHash,
    identifier: event.args.identifier,
    time: event.args.time,
    ancillaryData: event.args.ancillaryData,
  }));
  deletedRequests.forEach((request) => {
    logDeleted(logger, request, params.chainId);
  });
}
