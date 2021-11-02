import Web3 from "web3";
const { toBN } = Web3.utils;

import winston from "winston";
import { getAbi } from "@uma/contracts-node";
import { ZERO_ADDRESS } from "@uma/common";
import { GasEstimator, setAllowance } from "@uma/financial-templates-lib";

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

// Return the ballance of account on tokenAddress for a given web3 network.
export async function getTokenBalance(web3: Web3, tokenAddress: string, account: string): Promise<BN> {
  return toBN(await new web3.eth.Contract(getAbi("ExpandedERC20"), tokenAddress).methods.balanceOf(account).call());
}
