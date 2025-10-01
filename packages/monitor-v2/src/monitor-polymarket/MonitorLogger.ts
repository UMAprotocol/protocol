import { createEtherscanLinkMarkdown } from "@uma/common";
import { Logger, ONE_SCALED, PolymarketTradeInformation } from "./common";
import type {
  MonitoringParams,
  MultipleValuesQuery,
  OptimisticPriceRequest,
  PolymarketMarketGraphqlProcessed,
} from "./common";
import { tryHexToUtf8String } from "../utils/contracts";
import { ethers } from "ethers";

function formatAIDeeplinkMessage(deeplink?: string): string {
  return deeplink ? ` AI check: <${deeplink}|View UMA AI review>.` : "";
}

function generateUILink(transactionHash: string, chainId: number, eventIndex: number) {
  return `<https://oracle.uma.xyz/request?transactionHash=${transactionHash}&chainId=${chainId}&oracleType=OptimisticV2&eventIndex=${eventIndex} | View in the Oracle UI.>`;
}

function buildMarketIntro(
  market: OptimisticPriceRequest &
    Partial<PolymarketMarketGraphqlProcessed> & {
      multipleValuesQuery?: MultipleValuesQuery;
      scores?: [ethers.BigNumber, ethers.BigNumber];
      isSportsMarket: boolean;
    }
): string {
  if (!market.isSportsMarket) {
    return `A price of ${ethers.utils.formatEther(market.proposedPrice)} corresponding to outcome ${
      market.proposedPrice.eq(ONE_SCALED) ? 0 : 1
    } was proposed at ${market.proposalTimestamp.toString()} for the following question:  ${market.question}.`;
  } else {
    return `A price was proposed for the game "${
      market.multipleValuesQuery!.title
    }" at ${market.proposalTimestamp.toString()}. The final scores reported were: ${
      market.multipleValuesQuery!.labels[0]
    }: ${market.scores![0].toString()} and ${
      market.multipleValuesQuery!.labels[1]
    }: ${market.scores![1].toString()}. Details: ${market.multipleValuesQuery!.description}.`;
  }
}

function buildDisputeMessage(market: OptimisticPriceRequest, chainId: number): string {
  return (
    " The proposal can be disputed until " +
    new Date(Number(market.proposalExpirationTimestamp) * 1000).toUTCString() +
    ". " +
    generateUILink(market.requestHash, chainId, Number(market.requestLogIndex)) +
    " Please check the market proposal and dispute if necessary."
  );
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
    } & {
      scores: [ethers.BigNumber, ethers.BigNumber];
      multipleValuesQuery?: MultipleValuesQuery;
      isSportsMarket: boolean;
      aiDeeplink?: string;
    },
  params: MonitoringParams
): Promise<void> {
  const intro = buildMarketIntro(market);
  const extraDetails =
    (market.sellingWinnerSide
      ? ` Someone is trying to sell ${market.sellingWinnerSide.size} winner outcome tokens at a price of ${market.sellingWinnerSide.price} on the orderbook.`
      : "") +
    (market.buyingLoserSide
      ? ` Someone is trying to buy ${market.buyingLoserSide.size} loser outcome tokens at a price of ${market.buyingLoserSide.price} on the orderbook.`
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
      : "");

  logger.error({
    at: "PolymarketMonitor",
    message: "Difference between proposed price and market signal! 🚨",
    mrkdwn:
      intro +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.proposalHash, params.chainId) +
      extraDetails +
      buildDisputeMessage(market, params.chainId) +
      formatAIDeeplinkMessage(market.aiDeeplink),
    notificationPath: "polymarket-notifier",
  });
}

export async function logProposalAlignmentConfirmed(
  logger: typeof Logger,
  market: OptimisticPriceRequest &
    PolymarketMarketGraphqlProcessed & {
      scores?: [ethers.BigNumber, ethers.BigNumber];
      multipleValuesQuery?: MultipleValuesQuery;
      isSportsMarket: boolean;
      aiDeeplink?: string;
    },
  params: MonitoringParams
): Promise<void> {
  const intro = buildMarketIntro(market);

  logger.debug({
    at: "PolymarketMonitor",
    message: "Proposal Alignment Confirmed",
    mrkdwn:
      intro +
      " Market sentiment aligns with the proposed price. ✅" +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.proposalHash, params.chainId) +
      ` ` +
      generateUILink(market.requestHash, params.chainId, Number(market.requestLogIndex)) +
      formatAIDeeplinkMessage(market.aiDeeplink),
    notificationPath: "polymarket-notifier",
  });
}

export async function logProposalHighVolume(
  logger: typeof Logger,
  market: OptimisticPriceRequest &
    PolymarketMarketGraphqlProcessed & {
      scores: [ethers.BigNumber, ethers.BigNumber];
      multipleValuesQuery?: MultipleValuesQuery;
      isSportsMarket: boolean;
      aiDeeplink?: string;
    },
  params: MonitoringParams
): Promise<void> {
  const intro = buildMarketIntro(market);

  logger.error({
    at: "PolymarketMonitor",
    message: "A market with high volume has been proposed and needs to be checked! 🚨",
    mrkdwn:
      intro +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.proposalHash, params.chainId) +
      buildDisputeMessage(market, params.chainId) +
      formatAIDeeplinkMessage(market.aiDeeplink),
    notificationPath: "polymarket-notifier",
  });
}

export async function logFailedMarketProposalVerification(
  logger: typeof Logger,
  chainId: number,
  market: OptimisticPriceRequest,
  error: Error,
  aiDeeplink?: string
): Promise<void> {
  logger.error({
    at: "PolymarketMonitor",
    message: "Failed to verify proposed market, please verify manually! 🚨",
    mrkdwn:
      ` Failed to verify market:` +
      ` Ancillary data: ${tryHexToUtf8String(market.ancillaryData)}.` +
      ` Price request timestamp ${market.requestTimestamp.toString()}.` +
      buildDisputeMessage(market, chainId) +
      formatAIDeeplinkMessage(aiDeeplink),
    error,
    notificationPath: "polymarket-notifier",
  });
}
