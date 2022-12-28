import { Logger } from "@uma/financial-templates-lib";
import { VotingTokenEthers, getAddress } from "@uma/contracts-node";
import { utils } from "ethers";
import { logGovernorTransfer } from "./MonitorLogger";
import { getContractInstanceByUrl } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function monitorGovernorTransfers(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const governorTransfersThreshold = utils.parseEther(process.env.GOVERNOR_TRANSFERS_THRESHOLD || "0");

  const votingToken = await getContractInstanceByUrl<VotingTokenEthers>("VotingToken", params.jsonRpcUrl);
  const governorV2Address = await getAddress("GovernorV2", params.chainId);

  const largeGovernorTransfers = (
    await votingToken.queryFilter(
      votingToken.filters.Transfer(governorV2Address, null),
      params.startingBlock,
      params.endingBlock
    )
  )
    .filter((event) => event.args.value.gte(governorTransfersThreshold))
    .map((event) => ({
      tx: event.transactionHash,
      to: event.args.to.toString(),
      value: event.args.value.toString(),
    }));
  largeGovernorTransfers.forEach((transfer) => {
    logGovernorTransfer(logger, transfer, params.chainId);
  });
}
