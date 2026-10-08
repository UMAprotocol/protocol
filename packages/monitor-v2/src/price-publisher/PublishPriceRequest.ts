import { retryOnNonceConflict } from "@uma/common";
import { OracleHubEthers, OracleRootTunnelEthers } from "@uma/contracts-node";
import { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { PagerDutyRecoveryBatch } from "@uma/financial-templates-lib";
import { BigNumber, utils } from "ethers";
import { logPricePublished } from "./BotLogger";
import { Logger, MonitoringParams, POLYGON_CHAIN_ID } from "./common";

type PublicationOracle = OracleHubEthers | OracleRootTunnelEthers;

export async function publishPriceRequest(
  logger: typeof Logger,
  params: MonitoringParams,
  oracle: PublicationOracle,
  event: RequestResolvedEvent,
  destinationChain: number,
  callValue: BigNumber | undefined,
  recovery: PagerDutyRecoveryBatch
): Promise<boolean> {
  const { identifier, time, ancillaryData, price } = event.args;
  const requestHash = utils.keccak256(
    utils.defaultAbiCoder.encode(["bytes32", "uint256", "bytes"], [identifier, time, ancillaryData])
  );
  const pagerDutyDedupKey = `price-publisher:${params.chainId}:${oracle.address.toLowerCase()}:${requestHash}`;
  const isPublished = async () =>
    (await oracle.queryFilter(oracle.filters.PushedPrice(null, null, null, null, requestHash))).length > 0;

  try {
    const transaction = await retryOnNonceConflict(
      async () => {
        // Another run can publish this request while we back off. Check before allocating a fresh nonce.
        if (await isPublished()) return undefined;
        const nonce = await params.signer.getTransactionCount("pending");
        if (destinationChain === POLYGON_CHAIN_ID) {
          return (oracle as OracleRootTunnelEthers)
            .connect(params.signer)
            .publishPrice(identifier, time, ancillaryData, { nonce });
        }
        return (oracle as OracleHubEthers)
          .connect(params.signer)
          .publishPrice(destinationChain, identifier, time, ancillaryData, { value: callValue, nonce });
      },
      (error, attempt) =>
        logger.warn({
          at: "PricePublisher",
          message: "Retrying publication after nonce conflict",
          requestHash,
          error,
          attempt,
        })
    );

    if (transaction) {
      // Wait outside retry: a timeout after broadcast does not prove that resubmission is safe.
      const receipt = await transaction.wait();
      await logPricePublished(
        logger,
        {
          tx: receipt.transactionHash,
          identifier,
          ancillaryData,
          time,
          price,
          destinationChain,
        },
        params
      );
    }
    recovery.add(pagerDutyDedupKey);
    return true;
  } catch (error) {
    // Covers a competing successful publication and a replaced transaction. Only positive on-chain
    // evidence resolves an incident; failure to read chain state must never be interpreted as recovery.
    try {
      if (await isPublished()) {
        recovery.add(pagerDutyDedupKey);
        return true;
      }
    } catch {
      // Retain the original submission/wait error as the actionable failure.
    }
    logger.error({
      at: "PricePublisher",
      message: "Price publication remains unsuccessful",
      requestHash,
      destinationChain,
      error,
      pagerDutyDedupKey,
    });
    return false;
  }
}
