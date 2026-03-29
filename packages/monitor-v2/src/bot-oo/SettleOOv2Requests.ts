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
import { getSettleTxErrorLogFields, getSettleTxErrorLogLevel } from "../bot-utils/errors";

const MULTICALL_ABI = ["function multicall(bytes[] calldata data) external returns (bytes[] memory results)"];

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

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

  logger.debug({
    at: "OOv2Bot",
    message: "Querying ProposePrice events",
    fromBlock: searchConfig.fromBlock,
    toBlock: searchConfig.toBlock,
    maxBlockLookBack: searchConfig.maxBlockLookBack,
  });
  const proposalsStartedAt = Date.now();
  let proposals: ProposePriceEvent[];
  try {
    proposals = await paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);
    logger.debug({
      at: "OOv2Bot",
      message: "Queried ProposePrice events",
      count: proposals.length,
      elapsedMs: Date.now() - proposalsStartedAt,
    });
  } catch (error) {
    logger.error({
      at: "OOv2Bot",
      message: "Failed querying ProposePrice events",
      fromBlock: searchConfig.fromBlock,
      toBlock: searchConfig.toBlock,
      maxBlockLookBack: searchConfig.maxBlockLookBack,
      ...getSettleTxErrorLogFields(error),
    });
    throw error;
  }

  logger.debug({
    at: "OOv2Bot",
    message: "Querying Settle events",
    fromBlock: searchConfig.fromBlock,
    toBlock: searchConfig.toBlock,
    maxBlockLookBack: searchConfig.maxBlockLookBack,
  });
  const settlementsStartedAt = Date.now();
  let settlements: SettleEvent[];
  try {
    settlements = await paginatedEventQuery<SettleEvent>(oo, oo.filters.Settle(), searchConfig);
    logger.debug({
      at: "OOv2Bot",
      message: "Queried Settle events",
      count: settlements.length,
      elapsedMs: Date.now() - settlementsStartedAt,
    });
  } catch (error) {
    logger.error({
      at: "OOv2Bot",
      message: "Failed querying Settle events",
      fromBlock: searchConfig.fromBlock,
      toBlock: searchConfig.toBlock,
      maxBlockLookBack: searchConfig.maxBlockLookBack,
      ...getSettleTxErrorLogFields(error),
    });
    throw error;
  }

  const settledKeys = new Set(settlements.map((e) => requestKey(e.args)));

  const requestsToSettle = proposals.filter((e) => !settledKeys.has(requestKey(e.args)));

  const requestsToSettleTxCount =
    params.settleBatchSize > 1 ? Math.ceil(requestsToSettle.length / params.settleBatchSize) : requestsToSettle.length;

  logger.debug({
    at: "OOv2Bot",
    message: "Settlement candidates",
    totalProposals: proposals.length,
    settlements: settlements.length,
    requestsToSettle: requestsToSettle.length,
    settleTxCount: requestsToSettleTxCount,
    settleBatchSize: params.settleBatchSize,
  });

  const signerAddress = await params.signer.getAddress();

  // State.Resolved = 5: disputed and DVM price is available (settleable after dispute).
  const STATE_RESOLVED = 5;

  const settleableRequestsPromises = requestsToSettle.map(async (req) => {
    try {
      // When settleOnlyDisputed is enabled, check on-chain state and skip undisputed requests.
      if (params.botModes.settleOnlyDisputed) {
        const state = await oo.getState(
          req.args.requester,
          req.args.identifier,
          req.args.timestamp,
          req.args.ancillaryData
        );
        if (state !== STATE_RESOLVED) {
          logger.debug({
            at: "OOv2Bot",
            message: "Skipping non-disputed request (settleOnlyDisputed)",
            requestKey: requestKey(req.args),
            state,
          });
          return null;
        }
      }

      await oo.callStatic.settle(req.args.requester, req.args.identifier, req.args.timestamp, req.args.ancillaryData, {
        blockTag: params.settleableCheckBlock,
        from: signerAddress,
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
      logger.debug({
        at: "OOv2Bot",
        message: "Settle simulation failed",
        requestKey: requestKey(req.args),
        requester: req.args.requester,
        identifier: req.args.identifier,
        timestamp: req.args.timestamp.toString(),
        ...getSettleTxErrorLogFields(err),
      });
      return null;
    }
  });

  const settleableRequests = (await Promise.all(settleableRequestsPromises)).filter(
    (req): req is ProposePriceEvent => req !== null
  );

  const settleableTxCount =
    params.settleBatchSize > 1
      ? Math.ceil(settleableRequests.length / params.settleBatchSize)
      : settleableRequests.length;

  logger.debug({
    at: "OOv2Bot",
    message: "Settlement processing",
    totalProposals: proposals.length,
    settlements: settlements.length,
    requestsToSettle: requestsToSettle.length,
    settleableRequests: settleableRequests.length,
    settleTxCount: settleableTxCount,
    settleBatchSize: params.settleBatchSize,
  });

  if (settleableRequests.length > 0) {
    logger.debug({
      at: "OOv2Bot",
      message: "Settleable requests found",
      count: settleableRequests.length,
    });
  }

  if (params.settleBatchSize > 1) {
    await settleInBatches(logger, params, oo, settleableRequests, gasEstimator);
  } else {
    await settleOneByOne(logger, params, oo, settleableRequests, gasEstimator);
  }
}

async function settleOneByOne(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV2Ethers,
  settleableRequests: ProposePriceEvent[],
  gasEstimator: GasEstimator
): Promise<void> {
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
        ...getSettleTxErrorLogFields(error),
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}

async function settleBatch(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV2Ethers,
  batch: ProposePriceEvent[],
  gasEstimator: GasEstimator
): Promise<void> {
  const encodedCalls = batch.map((req) =>
    oo.interface.encodeFunctionData("settle", [
      req.args.requester,
      req.args.identifier,
      req.args.timestamp,
      req.args.ancillaryData,
    ])
  );

  const multicaller = new ethers.Contract(oo.address, MULTICALL_ABI, params.signer);
  const gasPricing = gasEstimator.getCurrentFastPriceEthers();

  const estimatedGas = await multicaller.estimateGas.multicall(encodedCalls);
  const gasLimit = estimatedGas.mul(params.gasLimitMultiplier).div(100);

  const tx = await multicaller.multicall(encodedCalls, { ...gasPricing, gasLimit });
  const receipt = await tx.wait();

  // Parse Settle events from receipt logs using the OOv2 interface.
  for (const log of receipt.logs) {
    try {
      const parsed = oo.interface.parseLog(log);
      if (parsed.name === "Settle") {
        const matchingReq = batch.find(
          (req) =>
            req.args.requester === parsed.args.requester &&
            req.args.identifier === parsed.args.identifier &&
            req.args.timestamp.eq(parsed.args.timestamp) &&
            req.args.ancillaryData === parsed.args.ancillaryData
        );
        if (matchingReq) {
          await logSettleRequest(
            logger,
            {
              tx: tx.hash,
              requester: matchingReq.args.requester,
              identifier: matchingReq.args.identifier,
              timestamp: matchingReq.args.timestamp,
              ancillaryData: matchingReq.args.ancillaryData,
              price: parsed.args.price ?? ethers.constants.Zero,
            },
            params
          );
        }
      }
    } catch {
      // Log entry not from OOv2 interface, skip.
    }
  }
}

async function settleInBatches(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV2Ethers,
  settleableRequests: ProposePriceEvent[],
  gasEstimator: GasEstimator
): Promise<void> {
  const batches = chunk(settleableRequests, params.settleBatchSize);

  let settled = 0;
  for (const batch of batches) {
    if (params.executionDeadline && Date.now() / 1000 >= params.executionDeadline) {
      logger.warn({
        at: "OOv2Bot",
        message: "Execution deadline reached, skipping settlement",
        remainingRequests: settleableRequests.length - settled,
      });
      break;
    }

    try {
      await settleBatch(logger, params, oo, batch, gasEstimator);
      settled += batch.length;
    } catch (error) {
      // Multicall reverts the entire batch if any call fails. Fall back to one-by-one for this batch.
      logger.warn({
        at: "OOv2Bot",
        message: "Multicall batch failed, falling back to one-by-one settlement",
        batchSize: batch.length,
        ...getSettleTxErrorLogFields(error),
      });
      await settleOneByOne(logger, params, oo, batch, gasEstimator);
      settled += batch.length;
    }
  }
}
