import { delay, Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { utils } from "ethers";
import { initCommonEnvVars, updateBlockRange } from "./common";
import { logLargeUnstake } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);
  const unstakeThreshold = utils.parseEther(process.env.UNSTAKE_THRESHOLD || "0");

  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

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
    if (params.pollingDelay === 0) break;
    await delay(Number(params.pollingDelay));
    await updateBlockRange(params);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
