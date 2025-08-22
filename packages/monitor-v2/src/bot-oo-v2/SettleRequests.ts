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

export async function settleRequests(logger: typeof Logger, params: MonitoringParams): Promise<void> {
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

  const settleable: RequestPriceEvent[] = [];
  for (const req of requestsToSettle) {
    try {
      // Attempt a static call to determine settle-ability. Will revert if not ready.
      await oo.callStatic.settle(req.args.requester, req.args.identifier, req.args.timestamp, req.args.ancillaryData);
      settleable.push(req);
      console.log(
        `Request ${requestKey(req.args)} is settleable for ${req.args.requester} ${req.args.identifier} ${
          req.args.timestamp
        }`
      );
    } catch (err) {
      console.log(`Request ${requestKey(req.args)} not settleable yet.`);
    }
  }

  for (const req of settleable) {
    const estimatedGas = await oo.estimateGas.settle(
      req.args.requester,
      req.args.identifier,
      req.args.timestamp,
      req.args.ancillaryData
    );
    const gasLimit = estimatedGas.mul(params.gasLimitMultiplier).div(100);
    const tx = await oo
      .connect(params.signer)
      .settle(req.args.requester, req.args.identifier, req.args.timestamp, req.args.ancillaryData, { gasLimit });
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
  }
}
