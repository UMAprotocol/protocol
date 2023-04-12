import { createEtherscanLinkMarkdown } from "@uma/common";
import { Logger } from "./common";

import type { MonitoringParams } from "./common";

function generateUILink(transactionHash: string, chainId: number, eventIndex: number) {
  return `<https://oracle.uma.xyz/request?transactionHash=${transactionHash}&chainId=${chainId}&oracleType=OptimisticV2&eventIndex=${eventIndex} | View in the Oracle UI.>`;
}

export async function logProposalOrderBook(
  logger: typeof Logger,
  market: {
    proposedPrice: string;
    proposalTime: number;
    proposedOutcome: string;
    question: string;
    tx: string;
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
    outcomes: [string, string];
    expirationTimestamp: number;
    eventIndex: number;
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "PolymarketMonitor",
    message: "Difference between proposed price and market signal! 🚨",
    mrkdwn:
      ` A price of ${market.proposedPrice} corresponding to outcome ${market.proposedOutcome} was proposed at ${market.proposalTime} for the following question:` +
      ` ${market.question}.` +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.tx, params.chainId) +
      (market.sellingWinnerSide
        ? ` Someone is trying to sell ${market.sellingWinnerSide?.size} winner outcome tokens at a price of ${market.sellingWinnerSide?.price} on the orderbook.`
        : "") +
      (market.buyingLoserSide
        ? ` Someone is trying to buy ${market.buyingLoserSide?.size} loser outcome tokens at a price of ${market.buyingLoserSide?.price} on the orderbook.`
        : "") +
      " The proposal can be disputed until " +
      new Date(market.expirationTimestamp * 1000).toUTCString() +
      ". " +
      generateUILink(market.tx, params.chainId, market.eventIndex) +
      ".",
    notificationPath: "polymarket-notifier",
  });
}
