import { paginatedEventQuery } from "@uma/common";
import {
  RequestPriceEvent,
  SettleEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { logSettleRequest } from "./BotLogger";
import { computeEventSearch } from "../bot-utils/events";
import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV2Ethers } from "./common";
import { ethers } from "ethers";

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

export async function settleOOv2Requests(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>("OptimisticOracleV2", params.provider);

  const searchConfig = await computeEventSearch(
    params.provider,
    params.blockFinder,
    params.timeLookback,
    params.maxBlockLookBack
  );

  const requests = await paginatedEventQuery<RequestPriceEvent>(oo, oo.filters.RequestPrice(), searchConfig);

  const settlements = await paginatedEventQuery<SettleEvent>(oo, oo.filters.Settle(), searchConfig);

  const settledKeys = new Set(settlements.map((e) => requestKey(e.args)));

  const requestsToSettle = requests.filter((e) => !settledKeys.has(requestKey(e.args))) as RequestPriceEvent[];

  const setteableRequestsPromises = requestsToSettle.map(async (req) => {
    try {
      await oo.callStatic.settle(req.args.requester, req.args.identifier, req.args.timestamp, req.args.ancillaryData);
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

  const setteableRequests = (await Promise.all(setteableRequestsPromises)).filter(
    (req): req is RequestPriceEvent => req !== null
  );

  if (setteableRequests.length > 0) {
    logger.debug({
      at: "OOv2Bot",
      message: "Settleable requests found",
      count: setteableRequests.length,
    });
  }

  const ooWithSigner = oo.connect(params.signer);

  for (const req of setteableRequests) {
    const estimatedGas = await oo.estimateGas.settle(
      req.args.requester,
      req.args.identifier,
      req.args.timestamp,
      req.args.ancillaryData
    );
    const gasLimitOverride = estimatedGas.mul(params.gasLimitMultiplier).div(100);

    try {
      const tx = await ooWithSigner.settle(
        req.args.requester,
        req.args.identifier,
        req.args.timestamp,
        req.args.ancillaryData,
        { gasLimit: gasLimitOverride }
      );
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
          price: (event?.args as SettleEvent["args"])?.price ?? ethers.constants.Zero,
        },
        params
      );
    } catch (error) {
      logger.error({
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
