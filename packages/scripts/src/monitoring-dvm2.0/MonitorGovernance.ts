import { Logger } from "@uma/financial-templates-lib";
import { GovernorV2Ethers } from "@uma/contracts-node";
import { logGovernanceProposal } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./MonitorCommon";

export async function monitorGovernance(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const governorV2 = await getContractInstanceByUrl<GovernorV2Ethers>("GovernorV2", params.jsonRpcUrl);

  const governanceProposals = (
    await governorV2.queryFilter(governorV2.filters.NewProposal(), params.startingBlock, params.endingBlock)
  ).map((event) => ({
    tx: event.transactionHash,
    id: event.args.id.toString(),
  }));
  governanceProposals.forEach((proposal) => {
    logGovernanceProposal(logger, proposal, params.chainId);
  });
}
