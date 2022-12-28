import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { utils } from "ethers";
import { logLargeUnstake } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./MonitorCommon";

export async function monitorUnstakes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const unstakeThreshold = utils.parseEther(process.env.UNSTAKE_THRESHOLD || "0");

  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  const largeUnstakes = (
    await votingV2.queryFilter(votingV2.filters.RequestedUnstake(), params.startingBlock, params.endingBlock)
  )
    .filter((event) => event.args.amount.gte(unstakeThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      address: event.args.voter,
      amount: event.args.amount.toString(),
    }));
  largeUnstakes.forEach((unstake) => {
    logLargeUnstake(logger, unstake, params.chainId);
  });
}
