import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber, utils } from "ethers";
import { Logger } from "./common";

import { tryHexToUtf8String } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function logPricePublished(
  logger: typeof Logger,
  priceRequest: {
    tx: string;
    identifier: string;
    ancillaryData: string;
    time: BigNumber;
    price: BigNumber;
    destinationChain: number;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "PricePublisher",
    message: "Price Published ✅",
    mrkdwn:
      "Price request with identifier " +
      utils.parseBytes32String(priceRequest.identifier) +
      " time " +
      priceRequest.time +
      " ancillary data " +
      tryHexToUtf8String(priceRequest.ancillaryData) +
      " and price " +
      priceRequest.price.toString() +
      " has been published to chain " +
      priceRequest.destinationChain +
      " in tx " +
      createEtherscanLinkMarkdown(priceRequest.tx, params.chainId) +
      ". ",
    notificationPath: "price-publisher",
  });
}
