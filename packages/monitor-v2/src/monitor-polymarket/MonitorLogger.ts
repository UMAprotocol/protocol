import { createEtherscanLinkMarkdown } from "@uma/common";
import { Logger, ONE_SCALED, PolymarketTradeInformation } from "./common";

import type { MonitoringParams, OptimisticPriceRequest, PolymarketMarketGraphqlProcessed } from "./common";
import { tryHexToUtf8String } from "../utils/contracts";
import { ethers } from "ethers";

function generateUILink(transactionHash: string, chainId: number, eventIndex: number) {
  return `<https://oracle.uma.xyz/request?transactionHash=${transactionHash}&chainId=${chainId}&oracleType=OptimisticV2&eventIndex=${eventIndex} | View in the Oracle UI.>`;
}

export async function logMarketSentimentDiscrepancy(
  logger: typeof Logger,
  market: OptimisticPriceRequest &
    PolymarketMarketGraphqlProcessed & {
      sellingWinnerSide:
        | {
            price: number;
            size: number;
          }
        | undefined;
      buyingLoserSide:
        | {
            price: number;
            size: number;
          }
        | undefined;
      soldWinnerSide: PolymarketTradeInformation[];
      boughtLoserSide: PolymarketTradeInformation[];
      outcomes: [string, string];
    },
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "PolymarketMonitor",
    message: "Difference between proposed price and market signal! 🚨",
    mrkdwn:
      ` A price of ${ethers.utils.formatEther(market.proposedPrice)} corresponding to outcome ${
        market.proposedPrice.eq(ONE_SCALED) ? 0 : 1
      } was proposed at ${market.proposalTimestamp.toString()} for the following question:` +
      ` ${market.question}.` +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.proposalHash, params.chainId) +
      (market.sellingWinnerSide
        ? ` Someone is trying to sell ${market.sellingWinnerSide?.size} winner outcome tokens at a price of ${market.sellingWinnerSide?.price} on the orderbook.`
        : "") +
      (market.buyingLoserSide
        ? ` Someone is trying to buy ${market.buyingLoserSide?.size} loser outcome tokens at a price of ${market.buyingLoserSide?.price} on the orderbook.`
        : "") +
      (market.soldWinnerSide.length > 0
        ? ` Someone sold winner outcome tokens at a price below the threshold. These are the trades: ${JSON.stringify(
            market.soldWinnerSide
          )}.`
        : "") +
      (market.boughtLoserSide.length > 0
        ? ` Someone bought loser outcome tokens at a price above the threshold. These are the trades: ${JSON.stringify(
            market.boughtLoserSide
          )}.`
        : "") +
      " The proposal can be disputed until " +
      new Date(Number(market.proposalExpirationTimestamp) * 1000).toUTCString() +
      ". " +
      generateUILink(market.requestHash, params.chainId, Number(market.requestLogIndex)) +
      " Please check the market proposal and dispute if necessary.",
    notificationPath: "polymarket-notifier",
  });
}

export async function logProposalHighVolume(
  logger: typeof Logger,
  market: OptimisticPriceRequest & PolymarketMarketGraphqlProcessed,
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "PolymarketMonitor",
    message: "A market with high volume has been proposed and needs to be checked! 🚨",
    mrkdwn:
      ` A price of ${ethers.utils.formatEther(market.proposedPrice)} corresponding to outcome ${
        market.proposedPrice.eq(ONE_SCALED) ? 0 : 1
      } was proposed at ${market.proposalTimestamp.toString()} for the following question:` +
      ` ${market.question}.` +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.proposalHash, params.chainId) +
      " The proposal can be disputed until " +
      new Date(Number(market.proposalExpirationTimestamp) * 1000).toUTCString() +
      ". " +
      generateUILink(market.requestHash, params.chainId, Number(market.requestLogIndex)) +
      " Please check the market proposal and dispute if necessary.",
    notificationPath: "polymarket-notifier",
  });
}

export async function logFailedMarketProposalVerification(
  logger: typeof Logger,
  chainId: number,
  market: OptimisticPriceRequest,
  error: Error
): Promise<void> {
  logger.error({
    at: "PolymarketMonitor",
    message: "Failed to verify proposed market, please verify manually! 🚨",
    mrkdwn:
      ` Failed to verify market:` +
      ` Ancillary data: ${tryHexToUtf8String(market.ancillaryData)}.` +
      ` Price request timestamp ${market.requestTimestamp.toString()}.` +
      " The proposal can be disputed until " +
      new Date(Number(market.proposalExpirationTimestamp) * 1000).toUTCString() +
      ". " +
      generateUILink(market.requestHash, chainId, Number(market.requestLogIndex)) +
      " Please check the market proposal and dispute if necessary.",
    error,
    notificationPath: "polymarket-notifier",
  });
}
