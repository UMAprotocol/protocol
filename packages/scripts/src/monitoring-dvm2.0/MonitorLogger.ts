import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { Logger } from "@uma/financial-templates-lib";

export const logLargeUnstake = (
  logger: typeof Logger,
  unstake: {
    tx: string;
    address: string;
    amount: string;
  },
  chainId: number
): void => {
  logger.warn({
    at: "DVMMonitorUnstake",
    message: "Large unstake requested 😟",
    mrkdwn:
      createEtherscanLinkMarkdown(unstake.address, chainId) +
      " requested unstake of " +
      createFormatFunction(2, 0, false, 18)(unstake.amount) +
      " UMA at " +
      createEtherscanLinkMarkdown(unstake.tx, chainId),
  });
};
