import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber } from "ethers";
import { Logger } from "./common";

import { parseBytes32String } from "ethers/lib/utils";
import { tryHexToUtf8String } from "../utils/contracts";
import type { MonitoringParams } from "./common";

export async function logPriceRequestSpeedUp(
  logger: typeof Logger,
  priceRequestInfo: {
    tx: string;
    originChainTx: string;
    time: BigNumber;
    ancillaryData: string;
    identifier: string;
    l2ChainId: number;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "PriceSpeedUp",
    message: "Price Request Sped Up ✅",
    mrkdwn:
      "Price request with identifier " +
      parseBytes32String(priceRequestInfo.identifier) +
      " time " +
      priceRequestInfo.time +
      " ancillary data " +
      tryHexToUtf8String(priceRequestInfo.ancillaryData) +
      " originating from chain " +
      priceRequestInfo.l2ChainId +
      " in tx " +
      createEtherscanLinkMarkdown(priceRequestInfo.originChainTx, priceRequestInfo.l2ChainId) +
      " has been sped up in chain " +
      params.chainId +
      " in tx " +
      createEtherscanLinkMarkdown(priceRequestInfo.tx, params.chainId) +
      ". ",
    notificationPath: "price-speed-up",
  });
}
