import Web3 from "web3";
const { toBN } = Web3.utils;

import winston from "winston";
import { getAbi } from "@uma/contracts-node";
import { ZERO_ADDRESS } from "@uma/common";
import { GasEstimator, setAllowance, InsuredBridgeL1Client, InsuredBridgeL2Client } from "@uma/financial-templates-lib";

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

// Iterate over queried list of whitelisted L1 tokens and remove any that are not whitelisted on a specific L2.
// The Relayer will use this whitelist to determine which deposits to relay. By default, the whitelist will be set
// to the list of all possible tokens provided in the on-chain RateModels dictionary. However, not all L1 tokens in this
// dictionary will be whitelisted for all L2 deposit boxes.
export async function pruneWhitelistedL1Tokens(
  logger: winston.Logger,
  l1Client: InsuredBridgeL1Client,
  l2Client: InsuredBridgeL2Client
): Promise<string[]> {
  // Fetch list of potential whitelisted L1 tokens from keys in the RateModelStore.
  const whitelistedRelayL1TokensInRateModel = l1Client.getL1TokensFromRateModel();

  // Compare tokens in rate model with whitelisted tokens for L2 chain ID. If the rate model doesn't include
  // all whitelisted tokens in the BridgeAdmin, then throw an error.
  const whitelistedRelayL1TokensInBridgeAdmin = l1Client.getWhitelistedTokensForChainId(l2Client.chainId.toString());
  for (const l1Token of Object.keys(whitelistedRelayL1TokensInBridgeAdmin)) {
    if (!whitelistedRelayL1TokensInRateModel.includes(l1Token))
      throw new Error(`Rate model does not include whitelisted token ${l1Token}`);
  }

  // Remove L1 tokens derived from rate model list that are not whitelisted for this L2.
  const prunedWhitelist = whitelistedRelayL1TokensInRateModel.filter((tokenAddress) =>
    Object.keys(whitelistedRelayL1TokensInBridgeAdmin).includes(tokenAddress)
  );

  if (prunedWhitelist.length === 0) {
    logger.error({
      at: "AcrossRelayer#RelayerHelper",
      message: "Filtered whitelist is empty",
      l2DepositBox: l2Client.bridgeDepositAddress,
    });
  } else {
    logger.debug({
      at: "AcrossRelayer#RelayerHelper",
      message: "Filtered out tokens that are not whitelisted on L2",
      l2DepositBox: l2Client.bridgeDepositAddress,
      prunedWhitelist,
    });
  }
  return prunedWhitelist;
}

// Return the ballance of account on tokenAddress for a given web3 network.
export async function getTokenBalance(web3: Web3, tokenAddress: string, account: string): Promise<BN> {
  return toBN(await new web3.eth.Contract(getAbi("ExpandedERC20"), tokenAddress).methods.balanceOf(account).call());
}
