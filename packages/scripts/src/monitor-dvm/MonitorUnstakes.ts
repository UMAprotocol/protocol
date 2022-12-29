import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { logLargeUnstake } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorUnstakes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  const largeUnstakes = (
    await votingV2.queryFilter(votingV2.filters.RequestedUnstake(), params.blockRange.start, params.blockRange.end)
  )
    .filter((event) => event.args.amount.gte(params.unstakeThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      address: event.args.voter,
      amount: event.args.amount.toString(),
    }));
  largeUnstakes.forEach((unstake) => {
    logLargeUnstake(logger, unstake, params.chainId);
  });
}
