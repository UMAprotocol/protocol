import { Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { utils } from "ethers";
import { logLargeStake } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorStakes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const stakeThreshold = utils.parseEther(process.env.STAKE_THRESHOLD || "0");

  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  const largeStakes = (await votingV2.queryFilter(votingV2.filters.Staked(), params.startingBlock, params.endingBlock))
    .filter((event) => event.args.amount.gte(stakeThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      address: event.args.voter,
      amount: event.args.amount.toString(),
    }));
  largeStakes.forEach((stake) => {
    logLargeStake(logger, stake, params.chainId);
  });
}
