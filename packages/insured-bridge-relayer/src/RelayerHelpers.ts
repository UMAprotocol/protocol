import Web3 from "web3";
const { toBN } = Web3.utils;

import winston from "winston";
import { getAbi } from "@uma/contracts-node";
import { ZERO_ADDRESS } from "@uma/common";
import { GasEstimator, setAllowance, InsuredBridgeL2Client } from "@uma/financial-templates-lib";

import type { BN } from "@uma/common";

// Iterates over a provided array of whitelistedRelayL1Tokens and for each: a) checks that this is a valid L1 token
// within the whitelist and b) approves this token to be spent by the associated L1 bridgePool.
export async function approveL1Tokens(
  logger: winston.Logger,
  web3: Web3,
  gasEstimator: GasEstimator,
  account: string,
  bridgeAdminAddress: string,
  whitelistedRelayL1Tokens: string[]
): Promise<void> {
  const bridgeAdmin = new web3.eth.Contract(getAbi("BridgeAdminInterface"), bridgeAdminAddress);

  for (const whitelistedL1Token of whitelistedRelayL1Tokens) {
    const bridgePool = (await bridgeAdmin.methods.whitelistedTokens(whitelistedL1Token, 0).call()).bridgePool;
    if (bridgePool === ZERO_ADDRESS) throw new Error("whitelistedRelayL1Tokens contains not-whitelisted token");
    const approvalTx = await setAllowance(web3, gasEstimator, account, bridgePool, whitelistedL1Token);
    if (approvalTx)
      logger.info({
        at: "InsuredBridgeRelayer",
        message: "Approved Bridge Pool to transfer unlimited whitelisted L1 tokens 💰",
        bridgePool,
        whitelistedL1Token,
        approvalTx: approvalTx.tx.transactionHash,
      });
  }
}

// Iterate over provided list of whitelisted L1 tokens and remove any that are not whitelisted on a specific L2.
// The Relayer will use this whitelist to determine which deposits to relay. By default, the whitelist will be set
// to the list of all possible tokens provided in the RateModels dictionary. However, not all L1 tokens in this
// dictionary will be whitelisted for all L2 deposit boxes.
export async function pruneWhitelistedL1Tokens(
  logger: winston.Logger,
  l2Client: InsuredBridgeL2Client,
  whitelistedRelayL1Tokens: string[]
): Promise<string[]> {
  await l2Client.update();
  const filteredWhitelistedRelayL1Tokens = whitelistedRelayL1Tokens.filter((l1TokenAddress: string) => {
    return l2Client.isWhitelistedToken(l1TokenAddress);
  });
  logger.debug({
    at: "AcrossRelayer#index",
    message: "Filtered out tokens that are not whitelisted on L2",
    filteredWhitelistedRelayL1Tokens,
  });
  return filteredWhitelistedRelayL1Tokens;
}

// Return the ballance of account on tokenAddress for a given web3 network.
export async function getTokenBalance(web3: Web3, tokenAddress: string, account: string): Promise<BN> {
  return toBN(await new web3.eth.Contract(getAbi("ExpandedERC20"), tokenAddress).methods.balanceOf(account).call());
}
