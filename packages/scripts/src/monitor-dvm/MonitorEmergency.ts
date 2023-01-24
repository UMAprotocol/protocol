import { Logger } from "@uma/financial-templates-lib";
import { EmergencyProposerEthers } from "@uma/contracts-node";
import { logEmergencyProposal } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorEmergency(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const emergencyProposer = await getContractInstanceWithProvider<EmergencyProposerEthers>(
    "EmergencyProposer",
    params.provider
  );

  const emergencyProposals = (
    await emergencyProposer.queryFilter(
      emergencyProposer.filters.EmergencyTransactionsProposed(),
      params.blockRange.start,
      params.blockRange.end
    )
  ).map((event) => ({
    tx: event.transactionHash,
    id: event.args.id.toString(),
    sender: event.args.sender,
  }));
  emergencyProposals.forEach((proposal) => {
    logEmergencyProposal(logger, proposal, params.chainId);
  });
}
