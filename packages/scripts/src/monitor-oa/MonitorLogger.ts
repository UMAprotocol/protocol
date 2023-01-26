import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { OptimisticAsserterEthers } from "@uma/contracts-node";
import { Logger } from "@uma/financial-templates-lib";
import { utils } from "ethers";
import { getCurrencyDecimals, getCurrencySymbol, tryHexToUtf8String } from "./common";

import type { MonitoringParams } from "./common";

export async function logAssertion(
  logger: typeof Logger,
  assertion: {
    tx: string;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticAsserterEthers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  const currencyDecimals = await getCurrencyDecimals(params.provider, assertion.assertionData.currency);
  const currencySymbol = await getCurrencySymbol(params.provider, assertion.assertionData.currency);
  logger.warn({
    at: "OAMonitor",
    message: "Assertion made 🙋",
    mrkdwn:
      createEtherscanLinkMarkdown(assertion.assertionData.asserter, params.chainId) +
      " made assertion with ID " +
      assertion.assertionId +
      " at " +
      new Date(Number(assertion.assertionData.assertionTime) * 1000).toUTCString() +
      " in transaction " +
      createEtherscanLinkMarkdown(assertion.tx, params.chainId) +
      ". Claim: " +
      tryHexToUtf8String(assertion.claim) +
      ". Identifier: " +
      utils.parseBytes32String(assertion.assertionData.identifier) +
      ". Bond: " +
      createFormatFunction(2, 2, false, currencyDecimals)(assertion.assertionData.bond.toString()) +
      " " +
      currencySymbol +
      ". The assertion can be disputed till " +
      new Date(Number(assertion.assertionData.expirationTime) * 1000).toUTCString(),
  });
}

export async function logDispute(
  logger: typeof Logger,
  dispute: {
    tx: string;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticAsserterEthers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "OAMonitor",
    message: "Assertion disputed ❌",
    mrkdwn:
      createEtherscanLinkMarkdown(dispute.assertionData.disputer, params.chainId) +
      " disputed assertion with ID " +
      dispute.assertionId +
      " in transaction " +
      createEtherscanLinkMarkdown(dispute.tx, params.chainId) +
      ". Claim: " +
      tryHexToUtf8String(dispute.claim) +
      ". Identifier: " +
      utils.parseBytes32String(dispute.assertionData.identifier),
  });
}

export async function logSettlement(
  logger: typeof Logger,
  settlement: {
    tx: string;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticAsserterEthers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  logger.info({
    at: "OAMonitor",
    message: "Assertion settled 🔗",
    mrkdwn:
      "Assertion with ID " +
      settlement.assertionId +
      " was settled in transaction " +
      createEtherscanLinkMarkdown(settlement.tx, params.chainId) +
      ". Claim: " +
      tryHexToUtf8String(settlement.claim) +
      ". Identifier: " +
      utils.parseBytes32String(settlement.assertionData.identifier) +
      ". Result: assertion was " +
      (settlement.assertionData.settlementResolution ? "true" : "false"),
  });
}
