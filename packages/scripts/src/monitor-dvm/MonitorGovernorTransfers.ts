import { Logger } from "@uma/financial-templates-lib";
import { VotingTokenEthers, getAddress } from "@uma/contracts-node";
import { logGovernorTransfer } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorGovernorTransfers(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingToken = await getContractInstanceWithProvider<VotingTokenEthers>("VotingToken", params.provider);
  const governorV2Address = await getAddress("GovernorV2", params.chainId);

  const largeGovernorTransfers = (
    await votingToken.queryFilter(
      votingToken.filters.Transfer(governorV2Address, null),
      params.blockRange.start,
      params.blockRange.end
    )
  )
    .filter((event) => event.args.value.gte(params.governorTransfersThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      to: event.args.to.toString(),
      value: event.args.value.toString(),
    }));
  largeGovernorTransfers.forEach((transfer) => {
    logGovernorTransfer(logger, transfer, params.chainId);
  });
}
