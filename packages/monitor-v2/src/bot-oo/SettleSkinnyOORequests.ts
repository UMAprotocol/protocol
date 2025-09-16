import { paginatedEventQuery } from "@uma/common";
import {
  DisputePriceEvent,
  ProposePriceEvent,
  SettleEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/SkinnyOptimisticOracle";
import { ethers } from "ethers";
import { computeEventSearch } from "../bot-utils/events";
import { tryHexToUtf8String } from "../utils/contracts";
import { logSettleRequest } from "./BotLogger";
import { getContractInstanceWithProvider, Logger, MonitoringParams, SkinnyOptimisticOracleEthers } from "./common";
import { requestKey } from "./requestKey";
import type { GasEstimator } from "@uma/financial-templates-lib";

const toRequestKeyArgs = (args: ProposePriceEvent["args"] | DisputePriceEvent["args"] | SettleEvent["args"]) => ({
  requester: args.requester,
  identifier: args.identifier,
  timestamp: ethers.BigNumber.from(args.timestamp),
  ancillaryData: args.ancillaryData,
});

export async function settleSkinnyOORequests(
  logger: typeof Logger,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
  const skinnyOO = await getContractInstanceWithProvider<SkinnyOptimisticOracleEthers>(
    "SkinnyOptimisticOracle",
    params.provider
  );
  const skinnyOOWithAddress = skinnyOO.attach(params.contractAddress);

  const searchConfig = await computeEventSearch(
    params.provider,
    params.blockFinder,
    params.timeLookback,
    params.maxBlockLookBack
  );

  const proposals = await paginatedEventQuery<ProposePriceEvent>(
    skinnyOOWithAddress,
    skinnyOOWithAddress.filters.ProposePrice(),
    searchConfig
  );

  const disputes = await paginatedEventQuery<DisputePriceEvent>(
    skinnyOOWithAddress,
    skinnyOOWithAddress.filters.DisputePrice(),
    searchConfig
  );

  const settlements = await paginatedEventQuery<SettleEvent>(
    skinnyOOWithAddress,
    skinnyOOWithAddress.filters.Settle(),
    searchConfig
  );

  const settledKeys = new Set(settlements.filter((e) => e && e.args).map((e) => requestKey(toRequestKeyArgs(e.args))));

  // Build a map of latest event per request key using both ProposePrice and DisputePrice.
  type SkinnyEvent = ProposePriceEvent | DisputePriceEvent;

  const byKey = new Map<string, SkinnyEvent>();

  const pushIfLatest = (e: SkinnyEvent | null | undefined) => {
    if (!e || !e.args) return;
    const key = requestKey(toRequestKeyArgs(e.args));
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, e);
      return;
    }
    // Keep the latest by blockNumber/logIndex
    if (e.blockNumber > current.blockNumber || (e.blockNumber === current.blockNumber && e.logIndex > current.logIndex))
      byKey.set(key, e);
  };

  proposals.forEach(pushIfLatest);
  disputes.forEach(pushIfLatest);

  // Exclude already settled requests.
  const candidatesToSettle: SkinnyEvent[] = Array.from(byKey.entries())
    .filter(([key]) => !settledKeys.has(key))
    .map(([, evt]) => evt);

  const settleableRequestsPromises = candidatesToSettle.map(async (req) => {
    try {
      // ProposePrice event carries the request struct at args[4]
      if (!(req && req.args && req.args.length > 4)) return null;
      const request = req.args.request;

      await skinnyOOWithAddress.callStatic.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        {
          proposer: request.proposer,
          disputer: request.disputer,
          currency: request.currency,
          settled: request.settled,
          proposedPrice: request.proposedPrice,
          resolvedPrice: request.resolvedPrice,
          expirationTime: request.expirationTime,
          reward: request.reward,
          finalFee: request.finalFee,
          bond: request.bond,
          customLiveness: request.customLiveness,
        }
      );

      logger.debug({
        at: "SkinnyOOBot",
        message: "Request is settleable",
        requestKey: requestKey(toRequestKeyArgs(req.args)),
        requester: req.args.requester,
        identifier: tryHexToUtf8String(req.args.identifier),
        timestamp: req.args.timestamp.toString(),
      });
      return { event: req, request };
    } catch (err) {
      logger.debug({
        at: "SkinnyOOBot",
        message: "Request not settleable yet",
        error: err instanceof Error ? err.message : String(err),
        reqArgs: req.args,
      });
      return null;
    }
  });

  const settleableRequests = (await Promise.all(settleableRequestsPromises)).filter((req) => req !== null);

  logger.debug({
    at: "SkinnyOOBot",
    message: "Settlement processing",
    totalProposals: proposals.length,
    totalDisputes: disputes.length,
    settlements: settlements.length,
    candidatesToSettle: candidatesToSettle.length,
    settleableRequests: settleableRequests.length,
  });

  if (settleableRequests.length > 0) {
    logger.debug({
      at: "SkinnyOOBot",
      message: "Settleable requests found",
      count: settleableRequests.length,
    });
  }

  const skinnyOOWithSigner = skinnyOOWithAddress.connect(params.signer);

  for (const settleableRequest of settleableRequests) {
    if (!settleableRequest) continue;
    const { event: req, request } = settleableRequest;

    try {
      const estimatedGas = await skinnyOOWithAddress.estimateGas.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        {
          proposer: request.proposer,
          disputer: request.disputer,
          currency: request.currency,
          settled: request.settled,
          proposedPrice: request.proposedPrice,
          resolvedPrice: request.resolvedPrice,
          expirationTime: request.expirationTime,
          reward: request.reward,
          finalFee: request.finalFee,
          bond: request.bond,
          customLiveness: request.customLiveness,
        }
      );
      const gasLimitOverride = estimatedGas.mul(params.gasLimitMultiplier).div(100);

      const tx = await skinnyOOWithSigner.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        {
          proposer: request.proposer,
          disputer: request.disputer,
          currency: request.currency,
          settled: request.settled,
          proposedPrice: request.proposedPrice,
          resolvedPrice: request.resolvedPrice,
          expirationTime: request.expirationTime,
          reward: request.reward,
          finalFee: request.finalFee,
          bond: request.bond,
          customLiveness: request.customLiveness,
        },
        { ...gasEstimator.getCurrentFastPriceEthers(), gasLimit: gasLimitOverride }
      );
      const receipt = await tx.wait();
      const event = receipt.events?.find((e) => e.event === "Settle");

      const skinnySettleArgs = (event as SettleEvent | undefined)?.args;

      await logSettleRequest(
        logger,
        {
          tx: tx.hash,
          requester: req.args.requester,
          identifier: req.args.identifier,
          timestamp: ethers.BigNumber.from(req.args.timestamp),
          ancillaryData: req.args.ancillaryData,
          price: skinnySettleArgs?.request?.resolvedPrice ?? ethers.constants.Zero,
        },
        params,
        "SkinnyOOBot"
      );
    } catch (error) {
      logger.error({
        at: "SkinnyOOBot",
        message: "Request settlement failed",
        requestKey: requestKey(toRequestKeyArgs(req.args)),
        error,
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}
