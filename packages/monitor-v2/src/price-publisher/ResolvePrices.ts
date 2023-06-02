import { VotingV2Ethers } from "@uma/contracts-node";
import { Logger, MonitoringParams, getContractInstanceWithProvider } from "./common";
import { logPriceResolved } from "./BotLogger";

export async function resolvePrices(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const { numberResolvedPriceRequests: before } = await votingV2.getNumberOfPriceRequests();
  const { numberResolvedPriceRequests: after } = await votingV2.callStatic.getNumberOfPriceRequestsPostUpdate();
  if (!before.eq(after)) {
    const receipt = await (await votingV2.connect(params.signer).processResolvablePriceRequests()).wait();
    for (const event of receipt.events || []) {
      if (event.event === "RequestResolved") {
        await logPriceResolved(
          logger,
          {
            tx: receipt.transactionHash,
            time: event.args?.time,
            ancillaryData: event.args?.ancillaryData,
            identifier: event.args?.identifier,
            price: event.args?.price,
          },
          params
        );
      }
    }
  }
}
