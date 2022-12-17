import { delay, Logger } from "@uma/financial-templates-lib";
import { VotingV2Ethers } from "@uma/contracts-node";
import { utils } from "ethers";
import { initCommonEnvVars, updateBlockRange } from "./common";
import { logLargeStake } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);
  const stakeThreshold = utils.parseEther(process.env.STAKE_THRESHOLD || "0");

  const votingV2 = await getContractInstanceByUrl<VotingV2Ethers>("VotingV2", params.jsonRpcUrl);

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

    const largeStakes = (
      await votingV2.queryFilter(votingV2.filters.Staked(), params.startingBlock, params.endingBlock)
    )
      .filter((event) => event.args.amount.gte(stakeThreshold))
      .map((event) => ({
        tx: event.transactionHash,
        address: event.args.voter,
        amount: event.args.amount.toString(),
      }));
    largeStakes.forEach((stake) => {
      logLargeStake(logger, stake, params.chainId);
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
