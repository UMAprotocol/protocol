import { Logger } from "@uma/financial-templates-lib";
import { EmergencyProposerEthers } from "@uma/contracts-node";
import { logEmergencyProposal } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./MonitorCommon";

export async function monitorEmergency(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const emergencyProposer = await getContractInstanceByUrl<EmergencyProposerEthers>(
    "EmergencyProposer",
    params.jsonRpcUrl
  );

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
}
