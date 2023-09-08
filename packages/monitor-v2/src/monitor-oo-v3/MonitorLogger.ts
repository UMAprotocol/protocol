import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { utils } from "ethers";
import { generateOOv3UILink, Logger, OptimisticOracleV3Ethers } from "./common";

import type { MonitoringParams } from "./common";
import { getCurrencyDecimals, getCurrencySymbol, tryHexToUtf8String } from "../utils/contracts";

export async function logAssertion(
  logger: typeof Logger,
  assertion: {
    tx: string;
    eventIndex: number;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticOracleV3Ethers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  const currencyDecimals = await getCurrencyDecimals(params.provider, assertion.assertionData.currency);
  const currencySymbol = await getCurrencySymbol(params.provider, assertion.assertionData.currency);
  logger.warn({
    at: "OOv3Monitor",
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
      new Date(Number(assertion.assertionData.expirationTime) * 1000).toUTCString() +
      ": " +
      generateOOv3UILink(assertion.tx, assertion.eventIndex, params.chainId) +
      ".",
    notificationPath: "optimistic-oracle",
    discordPaths: ["oo-fact-checking", "oo-events"],
    discordTicketChannel: "verifications-start-here",
  });
}

export async function logDispute(
  logger: typeof Logger,
  dispute: {
    tx: string;
    eventIndex: number;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticOracleV3Ethers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OOv3Monitor",
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
      utils.parseBytes32String(dispute.assertionData.identifier) +
      ". " +
      generateOOv3UILink(dispute.tx, dispute.eventIndex, params.chainId) +
      ".",
    notificationPath: "optimistic-oracle-disputes",
    discordPaths: ["oo-fact-checking", "oo-events"],
  });
}

export async function logSettlement(
  logger: typeof Logger,
  settlement: {
    tx: string;
    eventIndex: number;
    assertionId: string;
    claim: string;
    assertionData: Awaited<ReturnType<typeof OptimisticOracleV3Ethers.prototype.getAssertion>>;
  },
  params: MonitoringParams
): Promise<void> {
  logger.info({
    at: "OOv3Monitor",
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
      (settlement.assertionData.settlementResolution ? "true" : "false") +
      ". " +
      generateOOv3UILink(settlement.tx, settlement.eventIndex, params.chainId) +
      ".",
    notificationPath: "optimistic-oracle",
    discordPaths: ["oo-fact-checking", "oo-events"],
  });
}
