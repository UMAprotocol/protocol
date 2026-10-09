import { retryOnNonceConflict } from "@uma/common";
import { VotingV2Ethers } from "@uma/contracts-node";
import { Logger, MonitoringParams, getContractInstanceWithProvider } from "./common";
import { logPriceResolved } from "./BotLogger";

export async function resolvePrices(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const transaction = await retryOnNonceConflict(
    async () => {
      const { numberResolvedPriceRequests: before } = await votingV2.getNumberOfPriceRequests();
      const { numberResolvedPriceRequests: after } = await votingV2.callStatic.getNumberOfPriceRequestsPostUpdate();
      if (!before.eq(after)) {
        return votingV2.connect(params.signer).processResolvablePriceRequests({
          nonce: await params.signer.getTransactionCount("pending"),
        });
      }
      return undefined;
    },
    (error, attempt) =>
      logger.warn({
        at: "PricePublisher",
        message: "Retrying price resolution after nonce conflict",
        error,
        attempt,
      })
  );
  // Once broadcast, never submit again on a receipt timeout or ambiguous provider failure.
  if (transaction) {
    const receipt = await transaction.wait();
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
