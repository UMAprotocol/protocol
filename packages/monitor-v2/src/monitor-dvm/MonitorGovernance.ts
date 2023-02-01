import { Logger } from "@uma/financial-templates-lib";
import { GovernorV2Ethers } from "@uma/contracts-node";
import { logGovernanceProposal } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorGovernance(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const governorV2 = await getContractInstanceWithProvider<GovernorV2Ethers>("GovernorV2", params.provider);

  const governanceProposals = (
    await governorV2.queryFilter(governorV2.filters.NewProposal(), params.blockRange.start, params.blockRange.end)
  ).map((event) => ({
    tx: event.transactionHash,
    id: event.args.id.toString(),
  }));
  governanceProposals.forEach((proposal) => {
    logGovernanceProposal(logger, proposal, params.chainId);
  });
}
