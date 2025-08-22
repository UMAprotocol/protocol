import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { BigNumber, utils } from "ethers";
import { Logger } from "./common";

import type { MonitoringParams } from "./common";
import { tryHexToUtf8String } from "../utils/contracts";

export async function logSettleRequest(
  logger: typeof Logger,
  settlement: {
    tx: string;
    requester: string;
    identifier: string;
    timestamp: BigNumber;
    ancillaryData: string;
    price: BigNumber;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OOv2Bot",
    message: "Price Request Settled ✅",
    mrkdwn:
      "Request by " +
      settlement.requester +
      " settled in transaction " +
      createEtherscanLinkMarkdown(settlement.tx, params.chainId) +
      ". Identifier: " +
      utils.parseBytes32String(settlement.identifier) +
      ". Timestamp: " +
      settlement.timestamp.toString() +
      ". Ancillary: " +
      tryHexToUtf8String(settlement.ancillaryData) +
      ". Resolved Price: " +
      createFormatFunction(2, 2, false, 18)(settlement.price.toString()) +
      ".",
    notificationPath: "optimistic-oracle",
  });
}
