import { paginatedEventQuery, runEthersContractTransaction } from "@uma/common";
import {
  ProposePriceEvent,
  SettleEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { ethers } from "ethers";
import { computeEventSearch } from "../bot-utils/events";
import { logSettleRequest } from "./BotLogger";
import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV2Ethers } from "./common";
import { requestKey } from "./requestKey";
import type { GasEstimator } from "@uma/financial-templates-lib";
import { getSettleTxErrorLogLevel } from "../bot-utils/errors";

export async function settleOOv2Requests(
  logger: typeof Logger,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
    "OptimisticOracleV2",
    params.provider,
    params.contractAddress
  );

  const searchConfig = await computeEventSearch(
    params.provider,
    params.blockFinder,
    params.timeLookback,
    params.maxBlockLookBack
  );

  const proposals = await paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);

  const settlements = await paginatedEventQuery<SettleEvent>(oo, oo.filters.Settle(), searchConfig);

  const settledKeys = new Set(settlements.map((e) => requestKey(e.args)));

  const requestsToSettle = proposals.filter((e) => !settledKeys.has(requestKey(e.args)));

  const settleableRequestsPromises = requestsToSettle.map(async (req) => {
    try {
      await oo.callStatic.settle(req.args.requester, req.args.identifier, req.args.timestamp, req.args.ancillaryData, {
        blockTag: params.settleableCheckBlock,
      });
      logger.debug({
        at: "OOv2Bot",
        message: "Request is settleable",
        requestKey: requestKey(req.args),
        requester: req.args.requester,
        identifier: ethers.utils.parseBytes32String(req.args.identifier),
        timestamp: req.args.timestamp.toString(),
      });
      return req;
    } catch (err) {
      return null;
    }
  });

  const settleableRequests = (await Promise.all(settleableRequestsPromises)).filter(
    (req): req is ProposePriceEvent => req !== null
  );

  if (settleableRequests.length > 0) {
    logger.debug({
      at: "OOv2Bot",
      message: "Settleable requests found",
      count: settleableRequests.length,
    });
  }

  const ooWithSigner = oo.connect(params.signer);

  for (const [i, req] of settleableRequests.entries()) {
    if (params.executionDeadline && Date.now() / 1000 >= params.executionDeadline) {
      logger.warn({
        at: "OOv2Bot",
        message: "Execution deadline reached, skipping settlement",
        remainingRequests: settleableRequests.length - i,
      });
      break;
    }

    try {
      const populatedTx = await oo.populateTransaction.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        { ...gasEstimator.getCurrentFastPriceEthers() }
      );
      const tx = await runEthersContractTransaction(ooWithSigner, populatedTx, params.gasLimitMultiplier);
      const receipt = await tx.wait();
      const event = receipt.events?.find((e) => e.event === "Settle");

      await logSettleRequest(
        logger,
        {
          tx: tx.hash,
          requester: req.args.requester,
          identifier: req.args.identifier,
          timestamp: req.args.timestamp,
          ancillaryData: req.args.ancillaryData,
          price: (event as SettleEvent | undefined)?.args?.price ?? ethers.constants.Zero,
        },
        params
      );
    } catch (error) {
      logger[getSettleTxErrorLogLevel(error)]({
        at: "OOv2Bot",
        message: "Request settlement failed",
        requestKey: requestKey(req.args),
        error,
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}
