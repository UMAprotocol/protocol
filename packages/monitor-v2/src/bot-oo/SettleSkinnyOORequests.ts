import { paginatedEventQuery } from "@uma/common";
import { ethers } from "ethers";
import { logSettleRequest } from "./BotLogger";
import { computeEventSearch } from "../bot-utils/events";
import { getContractInstanceWithProvider, Logger, MonitoringParams, SkinnyOptimisticOracleEthers } from "./common";

const defaultLiveness = 7200; // Default liveness period

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

interface RequestPriceEvent {
  args: {
    requester: string;
    identifier: string;
    timestamp: ethers.BigNumber;
    ancillaryData: string;
    currency: string;
    reward: ethers.BigNumber;
    finalFee: ethers.BigNumber;
  };
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

const requestKey = (args: {
  requester: string;
  identifier: string;
  timestamp: ethers.BigNumber;
  ancillaryData: string;
}) =>
  ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["address", "bytes32", "uint256", "bytes"],
      [args.requester, args.identifier, args.timestamp, args.ancillaryData]
    )
  );

const reconstructRequest = async (requestEvent: RequestPriceEvent): Promise<SkinnyOORequest> => {
  // Get the actual request from the contract to populate missing fields

  return {
    proposer: ethers.constants.AddressZero,
    disputer: ethers.constants.AddressZero,
    currency: requestEvent.args.currency || ethers.constants.AddressZero,
    settled: false,
    proposedPrice: ethers.constants.Zero,
    resolvedPrice: ethers.constants.Zero,
    expirationTime: ethers.constants.Zero,
    reward: requestEvent.args.reward || ethers.constants.Zero,
    finalFee: requestEvent.args.finalFee || ethers.constants.Zero,
    bond: requestEvent.args.finalFee || ethers.constants.Zero, // Use finalFee as bond for now
    customLiveness: ethers.BigNumber.from(defaultLiveness), // Use the same liveness as contract deployment
  };
};

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

  // Create a map of proposals by request key
  const proposalsByRequestKey = new Map();
  proposals.forEach((proposal: any) => {
    if (proposal && proposal.args) {
      const key = requestKey(proposal.args);
      proposalsByRequestKey.set(key, proposal);
    }
  });

  const requestsToSettle = requests.filter((e: any) => e && e.args && !settledKeys.has(requestKey(e.args)));

  const setteableRequestsPromises = requestsToSettle.map(async (req: any) => {
    try {
      // Get the request ID and corresponding proposal if it exists
      const requestId = requestKey(req.args);
      const proposal = proposalsByRequestKey.get(requestId);

      let request;

      // If there's a proposal, use the request struct from the proposal args
      if (proposal && proposal.args && proposal.args.length > 4) {
        // The request struct is at index 4 in the proposal args
        request = proposal.args[4];
      } else {
        // Fallback to reconstructed request if no proposal found
        request = await reconstructRequest(req);
      }

      const state = await skinnyOOWithAddress.callStatic.getState(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        request
      );

      logger.debug({
        at: "SkinnyOOBot",
        message: "Checked request state",
        requestKey: requestKey(req.args),
        state: state.toString(),
        settleable: state === 1 || state === 3 || state === 4,
      });

      if (state === 1 || state === 3 || state === 4) {
        // SkinnyOO: state 1 = proposed & settleable after liveness
        logger.debug({
          at: "SkinnyOOBot",
          message: "Request is settleable",
          requestKey: requestKey(req.args),
          requester: req.args.requester,
          identifier: ethers.utils.parseBytes32String(req.args.identifier),
          timestamp: req.args.timestamp.toString(),
        });
        return { event: req, request };
      }
      return null;
    } catch (err) {
      logger.debug({
        at: "SkinnyOOBot",
        message: "Error checking state",
        error: err instanceof Error ? err.message : String(err),
        reqArgs: req.args,
      });
      return null;
    }
  });

  const setteableRequests = (await Promise.all(setteableRequestsPromises)).filter((req: any) => req !== null);

  logger.debug({
    at: "SkinnyOOBot",
    message: "Settlement processing",
    totalRequests: requests.length,
    settlements: settlements.length,
    requestsToSettle: requestsToSettle.length,
    setteableRequests: setteableRequests.length,
  });

  if (setteableRequests.length > 0) {
    logger.debug({
      at: "SkinnyOOBot",
      message: "Settleable requests found",
      count: setteableRequests.length,
    });
  }

  const skinnyOOWithSigner = skinnyOOWithAddress.connect(params.signer);

  for (const settleableRequest of setteableRequests) {
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
          price: (event?.args as SettleEvent["args"])?.price ?? ethers.constants.Zero,
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
