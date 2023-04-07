import { createEtherscanLinkMarkdown } from "@uma/common";
import { Logger } from "./common";

import type { MonitoringParams } from "./common";

function generateUILink(transactionHash: string, chainId: number, eventIndex: number) {
  return `<https://oracle.uma.xyz/request?transactionHash=${transactionHash}&chainId=${chainId}&oracleType=OptimisticV2&eventIndex=${eventIndex} | View in the Oracle UI.>`;
}

export async function logProposal(
  logger: typeof Logger,
  market: {
    proposedPrice: string;
    proposalTime: number;
    proposedOutcome: string;
    question: string;
    tx: string;
    tradeSignals: [number, number];
    historicOrderbookSignals: [number, number];
    outcomes: [string, string];
    expirationTimestamp: number;
    eventIndex: number;
  },
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "PolymarketMonitor",
    message: "Difference between proposed price and market signal! 🚨",
    mrkdwn:
      ` A price of ${market.proposedPrice} corresponding to outcome ${market.proposedOutcome} was proposed at ${market.proposalTime} for the following question:` +
      ` ${market.question}.` +
      ` In the following transaction: ` +
      createEtherscanLinkMarkdown(market.tx, params.chainId) +
      `. The calculated trade signals are ${market.outcomes[0]}:${market.tradeSignals[0]} and ${market.outcomes[1]}:${market.tradeSignals[1]}.` +
      ` The calculated historic orderbook signals are ${market.outcomes[0]}:${market.historicOrderbookSignals[0]} and ${market.outcomes[1]}:${market.historicOrderbookSignals[1]}.` +
      " The proposal can be disputed until " +
      new Date(market.expirationTimestamp * 1000).toUTCString() +
      ". " +
      generateUILink(market.tx, params.chainId, market.eventIndex) +
      ".",
    notificationPath: "polymarket-notifier",
  });
}
