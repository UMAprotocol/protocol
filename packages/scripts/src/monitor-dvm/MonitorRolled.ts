import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { logRolled } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorRolled(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const rolledRequests = (
    await votingV2.queryFilter(votingV2.filters.RequestRolled(), params.blockRange.start, params.blockRange.end)
  ).map((event) => ({
    tx: event.transactionHash,
    identifier: event.args.identifier,
    time: event.args.time,
    ancillaryData: event.args.ancillaryData,
  }));
  rolledRequests.forEach((request) => {
    logRolled(logger, request, params.chainId);
  });
}
