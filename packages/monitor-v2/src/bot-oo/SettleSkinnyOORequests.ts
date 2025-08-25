import { paginatedEventQuery } from "@uma/common";
import { ethers } from "ethers";
import { logSettleRequest } from "./BotLogger";
import { computeEventSearch } from "../bot-utils/events";
import { getContractInstanceWithProvider, Logger, MonitoringParams, SkinnyOptimisticOracleEthers } from "./common";
import { requestKey } from "./requestKey";
import { tryHexToUtf8String } from "../utils/contracts";

interface SkinnyOORequest {
  proposer: string;
  disputer: string;
  currency: string;
  settled: boolean;
  proposedPrice: ethers.BigNumber;
  resolvedPrice: ethers.BigNumber;
  expirationTime: ethers.BigNumber;
  reward: ethers.BigNumber;
  finalFee: ethers.BigNumber;
  bond: ethers.BigNumber;
  customLiveness: ethers.BigNumber;
}

interface SettleEvent {
  args: {
    requester: string;
    identifier: string;
    timestamp: ethers.BigNumber;
    ancillaryData: string;
    price: ethers.BigNumber;
    payout: ethers.BigNumber;
  };
}

export async function settleSkinnyOORequests(logger: typeof Logger, params: MonitoringParams): Promise<void> {
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

  const requests = await paginatedEventQuery(
    skinnyOOWithAddress,
    skinnyOOWithAddress.filters.RequestPrice(),
    searchConfig
  );

  // Also get proposals to understand the updated request state
  const proposals = skinnyOOWithAddress.filters.ProposePrice
    ? await paginatedEventQuery(skinnyOOWithAddress, skinnyOOWithAddress.filters.ProposePrice(), searchConfig)
    : [];

  const settlements = await paginatedEventQuery(
    skinnyOOWithAddress,
    skinnyOOWithAddress.filters.Settle(),
    searchConfig
  );

  const settledKeys = new Set(settlements.filter((e) => e && e.args).map((e: any) => requestKey(e.args)));

  // Create a map of the latest proposal by request key
  const proposalsByRequestKey = new Map<string, any>();
  proposals.forEach((proposal: any) => {
    if (proposal && proposal.args) {
      const key = requestKey(proposal.args);
      proposalsByRequestKey.set(key, proposal);
    }
  });

  const requestsToSettle = requests.filter((e: any) => e && e.args && !settledKeys.has(requestKey(e.args)));

  const settleableRequestsPromises = requestsToSettle.map(async (req: any) => {
    try {
      // Get the request ID and corresponding proposal if it exists
      const requestId = requestKey(req.args);
      const proposal = proposalsByRequestKey.get(requestId);

      // Require a proposal carrying the request struct; otherwise, skip
      if (!(proposal && proposal.args && proposal.args.length > 4)) return null;
      const request = proposal.args[4] as SkinnyOORequest;

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
        requestKey: requestKey(req.args),
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

  const settleableRequests = (await Promise.all(settleableRequestsPromises)).filter((req: any) => req !== null);

  logger.debug({
    at: "SkinnyOOBot",
    message: "Settlement processing",
    totalRequests: requests.length,
    settlements: settlements.length,
    requestsToSettle: requestsToSettle.length,
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

    try {
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
        { gasLimit: gasLimitOverride }
      );
      const receipt = await tx.wait();
      const event = receipt.events?.find((e: any) => e.event === "Settle");

      await logSettleRequest(
        logger,
        {
          tx: tx.hash,
          requester: req.args.requester,
          identifier: req.args.identifier,
          timestamp: req.args.timestamp,
          ancillaryData: req.args.ancillaryData,
          price: ((event?.args as unknown) as SettleEvent["args"])?.price ?? ethers.constants.Zero,
        },
        params,
        "SkinnyOOBot"
      );
    } catch (error) {
      logger.error({
        at: "SkinnyOOBot",
        message: "Request settlement failed",
        requestKey: requestKey(req.args),
        error,
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}
