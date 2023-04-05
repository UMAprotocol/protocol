import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { BigNumber, utils } from "ethers";
import { Logger } from "./common";

import type { MonitoringParams } from "./common";
import { getCurrencyDecimals, getCurrencySymbol, tryHexToUtf8String } from "../utils/contracts";

export async function logSettleAssertion(
  logger: typeof Logger,
  assertion: {
    tx: string;
    assertionId: string;
    claim: string;
    bond: BigNumber;
    identifier: string;
    currency: string;
    settlementResolution: boolean;
  },
  params: MonitoringParams
): Promise<void> {
  const currencyDecimals = await getCurrencyDecimals(params.provider, assertion.currency);
  const currencySymbol = await getCurrencySymbol(params.provider, assertion.currency);
  logger.warn({
    at: "OOv3Bot",
    message: "Assertion Settled ✅",
    mrkdwn:
      "Assertion with ID " +
      assertion.assertionId +
      " settled in transaction " +
      createEtherscanLinkMarkdown(assertion.tx, params.chainId) +
      ". Claim: " +
      tryHexToUtf8String(assertion.claim) +
      ". Settlement Resolution: " +
      assertion.settlementResolution +
      ". Identifier: " +
      utils.parseBytes32String(assertion.identifier) +
      ". Bond: " +
      createFormatFunction(2, 2, false, currencyDecimals)(assertion.bond.toString()) +
      " " +
      currencySymbol +
      ".",
    notificationPath: "optimistic-oracle",
  });
}
