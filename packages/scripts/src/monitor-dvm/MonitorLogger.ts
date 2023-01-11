import { createEtherscanLinkMarkdown, createFormatFunction } from "@uma/common";
import { Logger } from "@uma/financial-templates-lib";
import { utils } from "ethers";
import { tryHexToUtf8String } from "./common";
import type { BigNumber } from "ethers";

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
    at: "DVMMonitor",
    message: "Large unstake requested 😟",
    mrkdwn:
      createEtherscanLinkMarkdown(unstake.address, chainId) +
      " requested unstake of " +
      createFormatFunction(2, 2, false, 18)(unstake.amount) +
      " UMA at " +
      createEtherscanLinkMarkdown(unstake.tx, chainId),
  });
};

export const logLargeStake = (
  logger: typeof Logger,
  stake: {
    tx: string;
    address: string;
    amount: string;
  },
  chainId: number
): void => {
  logger.warn({
    at: "DVMMonitor",
    message: "Large amount staked 🍖",
    mrkdwn:
      createEtherscanLinkMarkdown(stake.address, chainId) +
      " staked " +
      createFormatFunction(2, 2, false, 18)(stake.amount) +
      " UMA at " +
      createEtherscanLinkMarkdown(stake.tx, chainId),
  });
};

export const logGovernanceProposal = (
  logger: typeof Logger,
  proposal: {
    tx: string;
    id: string;
  },
  chainId: number
): void => {
  logger.warn({
    at: "DVMMonitor",
    message: "New governance proposal created 📜",
    mrkdwn: "New Admin " + proposal.id + " proposal created at " + createEtherscanLinkMarkdown(proposal.tx, chainId),
  });
};

export const logEmergencyProposal = (
  logger: typeof Logger,
  proposal: {
    tx: string;
    id: string;
    sender: string;
  },
  chainId: number
): void => {
  logger.error({
    at: "DVMMonitor",
    message: "New emergency proposal created 🚨",
    mrkdwn:
      proposal.sender +
      " submitted new emergency proposal #" +
      proposal.id +
      " at " +
      createEtherscanLinkMarkdown(proposal.tx, chainId),
  });
};

export const logDeleted = (
  logger: typeof Logger,
  request: {
    tx: string;
    identifier: string;
    time: BigNumber;
    ancillaryData: string;
  },
  chainId: number
): void => {
  logger.error({
    at: "DVMMonitor",
    message: "Request deleted as spam 🔇",
    mrkdwn:
      "Request for identifier " +
      utils.parseBytes32String(request.identifier) +
      " at " +
      new Date(Number(request.time) * 1000).toUTCString() +
      " was deleted as spam at " +
      createEtherscanLinkMarkdown(request.tx, chainId) +
      ". Ancillary data: " +
      tryHexToUtf8String(request.ancillaryData),
  });
};

export const logRolled = (
  logger: typeof Logger,
  request: {
    tx: string;
    identifier: string;
    time: BigNumber;
    ancillaryData: string;
  },
  chainId: number
): void => {
  logger.error({
    at: "DVMMonitor",
    message: "Rolled request 🎲",
    mrkdwn:
      "Request for identifier " +
      utils.parseBytes32String(request.identifier) +
      " at " +
      new Date(Number(request.time) * 1000).toUTCString() +
      " was rolled at " +
      createEtherscanLinkMarkdown(request.tx, chainId) +
      ". Ancillary data: " +
      tryHexToUtf8String(request.ancillaryData),
  });
};

export const logGovernorTransfer = (
  logger: typeof Logger,
  transfer: {
    tx: string;
    to: string;
    value: string;
  },
  chainId: number
): void => {
  logger.error({
    at: "DVMMonitor",
    message: "Large governor transfer 📤",
    mrkdwn:
      createFormatFunction(2, 2, false, 18)(transfer.value) +
      " UMA was transferred from governor to " +
      createEtherscanLinkMarkdown(transfer.to, chainId) +
      " at " +
      createEtherscanLinkMarkdown(transfer.tx, chainId),
  });
};

export const logMint = (
  logger: typeof Logger,
  mint: {
    tx: string;
    to: string;
    value: string;
  },
  chainId: number
): void => {
  logger.error({
    at: "DVMMonitor",
    message: "Large UMA minting 💸",
    mrkdwn:
      createFormatFunction(2, 2, false, 18)(mint.value) +
      " UMA was minted to " +
      createEtherscanLinkMarkdown(mint.to, chainId) +
      " at " +
      createEtherscanLinkMarkdown(mint.tx, chainId),
  });
};
