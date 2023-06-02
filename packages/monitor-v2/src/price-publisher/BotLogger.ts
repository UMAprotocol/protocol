import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber, utils } from "ethers";
import { Logger } from "./common";

import { parseBytes32String } from "ethers/lib/utils";
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

export async function logPriceResolved(
  logger: typeof Logger,
  resolvedEventInfo: {
    tx: string;
    time: BigNumber;
    ancillaryData: string;
    identifier: string;
    price: BigNumber;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "PricePublisher",
    message: "Price Resolved ✅",
    mrkdwn:
      "Price request with identifier " +
      parseBytes32String(resolvedEventInfo.identifier) +
      " time " +
      resolvedEventInfo.time +
      " ancillary data " +
      tryHexToUtf8String(resolvedEventInfo.ancillaryData) +
      " and price " +
      resolvedEventInfo.price.toString() +
      " has been resolved " +
      " in tx " +
      createEtherscanLinkMarkdown(resolvedEventInfo.tx, params.chainId) +
      ". ",
    notificationPath: "price-publisher",
  });
}
