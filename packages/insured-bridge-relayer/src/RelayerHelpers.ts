import winston from "winston";
import Web3 from "web3";
import { getAbi } from "@uma/contracts-node";
import { ZERO_ADDRESS } from "@uma/common";
import { GasEstimator, setAllowance } from "@uma/financial-templates-lib";

// Iterates over a provided array of whitelistedRelayL1Tokens and for each: a) checks that this is a valid L1 token
// within the whitelist and b) approves this token to be spent by the associated L1 bridgePool.
export async function approveL1Tokens(
  logger: winston.Logger,
  web3: Web3,
  gasEstimator: GasEstimator,
  account: string,
  bridgeAdminAddress: string,
  whitelistedRelayL1Tokens: string[]
) {
  console.log("bridgeAdminAddress", bridgeAdminAddress);
  console.log("whitelistedRelayL1Tokens", whitelistedRelayL1Tokens);
  const bridgeAdmin = new web3.eth.Contract(getAbi("BridgeAdmin"), bridgeAdminAddress);

  for (const whitelistedL1Token of whitelistedRelayL1Tokens) {
    console.log("whitelistedL1Token", whitelistedL1Token);
    const bridgePool = (await bridgeAdmin.methods.whitelistedTokens(whitelistedL1Token).call()).bridgePool;
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

// Returns the L2 Deposit box address for a given bridgeAdmin
export async function getL2DepositBoxAddress(web3: Web3, bridgeAdminAddress: string) {
  return await new web3.eth.Contract(getAbi("BridgeAdmin"), bridgeAdminAddress).methods.depositContract().call();
}
