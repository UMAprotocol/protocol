import { Logger } from "@uma/financial-templates-lib";
import { ZERO_ADDRESS } from "@uma/common";
import { VotingTokenEthers } from "@uma/contracts-node";
import { logMint } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorMints(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingToken = await getContractInstanceWithProvider<VotingTokenEthers>("VotingToken", params.provider);

  const largeMints = (
    await votingToken.queryFilter(
      votingToken.filters.Transfer(ZERO_ADDRESS, null),
      params.blockRange.start,
      params.blockRange.end
    )
  )
    .filter((event) => event.args.value.gte(params.mintsThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      to: event.args.to.toString(),
      value: event.args.value.toString(),
    }));
  largeMints.forEach((mint) => {
    logMint(logger, mint, params.chainId);
  });
}
