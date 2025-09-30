import { paginatedEventQuery, runEthersContractTransaction } from "@uma/common";
import {
  ProposePriceEvent,
  SettleEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracle";
import { ethers } from "ethers";
import { computeEventSearch } from "../bot-utils/events";
import { tryHexToUtf8String } from "../utils/contracts";
import { logSettleRequest } from "./BotLogger";
import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleEthers } from "./common";
import { requestKey } from "./requestKey";
import type { GasEstimator } from "@uma/financial-templates-lib";
import { getSettleTxErrorLogLevel } from "../bot-utils/errors";

export async function settleOOv1Requests(
  logger: typeof Logger,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
  const oov1 = await getContractInstanceWithProvider<OptimisticOracleEthers>("OptimisticOracle", params.provider);
  // Override with the test contract address
  const oov1WithAddress = oov1.attach(params.contractAddress);

  const searchConfig = await computeEventSearch(
    params.provider,
    params.blockFinder,
    params.timeLookback,
    params.maxBlockLookBack
  );

  const proposals = await paginatedEventQuery<ProposePriceEvent>(
    oov1WithAddress,
    oov1WithAddress.filters.ProposePrice(),
    searchConfig
  );

  const settlements = await paginatedEventQuery<SettleEvent>(
    oov1WithAddress,
    oov1WithAddress.filters.Settle(),
    searchConfig
  );

  const settledKeys = new Set(settlements.filter((e) => e && e.args).map((e) => requestKey(e.args)));

  const proposalsToSettle = proposals.filter((e) => e && e.args && !settledKeys.has(requestKey(e.args)));

  const settleableRequestsPromises = proposalsToSettle.map(async (req) => {
    try {
      await oov1WithAddress.callStatic.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        { blockTag: params.settleableCheckBlock }
      );
      logger.debug({
        at: "OOv1Bot",
        message: "Request is settleable",
        requestKey: requestKey(req.args),
        requester: req.args.requester,
        identifier: tryHexToUtf8String(req.args.identifier),
        timestamp: req.args.timestamp.toString(),
      });
      return req;
    } catch (err) {
      logger.debug({
        at: "OOv1Bot",
        message: "Request not settleable yet",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  });

  const settleableRequests = (await Promise.all(settleableRequestsPromises)).filter(
    (req): req is ProposePriceEvent => req !== null
  );

  logger.debug({
    at: "OOv1Bot",
    message: "Settlement processing",
    totalProposals: proposals.length,
    settlements: settlements.length,
    proposalsToSettle: proposalsToSettle.length,
    settleableRequests: settleableRequests.length,
  });

  if (settleableRequests.length > 0) {
    logger.debug({
      at: "OOv1Bot",
      message: "Settleable requests found",
      count: settleableRequests.length,
    });
  }

  const oov1WithSigner = oov1WithAddress.connect(params.signer);

  for (const [i, req] of settleableRequests.entries()) {
    if (params.executionDeadline && Date.now() / 1000 >= params.executionDeadline) {
      logger.warn({
        at: "OOv1Bot",
        message: "Execution deadline reached, skipping settlement",
        remainingRequests: settleableRequests.length - i,
      });
      break;
    }

    try {
      const populatedTx = await oov1WithAddress.populateTransaction.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        { ...gasEstimator.getCurrentFastPriceEthers() }
      );
      const tx = await runEthersContractTransaction(oov1WithSigner, populatedTx, params.gasLimitMultiplier);
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
        params,
        "OOv1Bot"
      );
    } catch (error) {
      logger[getSettleTxErrorLogLevel(error)]({
        at: "OOv1Bot",
        message: "Request settlement failed",
        requestKey: requestKey(req.args),
        error,
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}
