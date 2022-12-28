import { Logger } from "@uma/financial-templates-lib";
import { ZERO_ADDRESS } from "@uma/common";
import { VotingTokenEthers } from "@uma/contracts-node";
import { utils } from "ethers";
import { logMint } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorMints(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const mintsThreshold = utils.parseEther(process.env.MINTS_THRESHOLD || "0");

  const votingToken = await getContractInstanceByUrl<VotingTokenEthers>("VotingToken", params.jsonRpcUrl);

  const largeMints = (
    await votingToken.queryFilter(
      votingToken.filters.Transfer(ZERO_ADDRESS, null),
      params.startingBlock,
      params.endingBlock
    )
  )
    .filter((event) => event.args.value.gte(mintsThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      to: event.args.to.toString(),
      value: event.args.value.toString(),
    }));
  largeMints.forEach((mint) => {
    logMint(logger, mint, params.chainId);
  });
}
