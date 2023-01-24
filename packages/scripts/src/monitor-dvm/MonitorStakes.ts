import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { logLargeStake } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorStakes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const largeStakes = (
    await votingV2.queryFilter(votingV2.filters.Staked(), params.blockRange.start, params.blockRange.end)
  )
    .filter((event) => event.args.amount.gte(params.stakeThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      address: event.args.voter,
      amount: event.args.amount.toString(),
    }));
  largeStakes.forEach((stake) => {
    logLargeStake(logger, stake, params.chainId);
  });
}
