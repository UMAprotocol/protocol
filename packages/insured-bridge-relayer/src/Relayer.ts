import Web3 from "web3";
import winston from "winston";
import { getAbi, ExpandedERC20Web3 } from "@uma/contracts-node";

import { InsuredBridgeL1Client, InsuredBridgeL2Client, Deposit } from "@uma/financial-templates-lib";

enum RelayerMode {
  OnlySlow,
  OnlySpeedUp,
  Any,
}

enum RelayType {
  Slow,
  Fast,
  IgnoreRelay,
}

export class Relayer {
  /**
   * @notice Constructs new Relayer Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} web3 Provider from Truffle/node to connect to Ethereum network.
   * @param {Object} l1Client Client for fetching L1 data from the insured bridge pool and admin contracts.
   * @param {Object} l2Client Client for fetching L2 deposit data.
   * @param {Array} whitelistedRelayL1Tokens List of whitelisted L1 tokens that the relayer supports.
   * @param {string} account Unlocked web3 account to send L1 messages.
   * @param {RelayerMode} relayerMode Mode the relayer is placed in which influences how the relayer behaves.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly web3: Web3,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly whitelistedRelayL1Tokens: string[],
    readonly account: string,
    readonly relayerMode: RelayerMode = RelayerMode.Any
  ) {}

  // TODO: consider refactoring this further into multiple methods. One to build the object of relayableDeposits and one
  // that processes relayableDeposits and calls respective relaying functions.
  async checkForPendingDepositsAndRelay() {
    this.logger.debug({ at: "Relayer", message: "Checking for pending deposits and relaying" });
    const relayableDeposits: { [key: string]: any } = {};
    for (const l1Token of this.whitelistedRelayL1Tokens) {
      this.logger.debug({ at: "Relayer", message: "Checking relays for token", l1Token });
      // TODO: consider limiting how far back we look in this call size.
      const l2Deposits = this.l2Client.getAllDeposits();
      relayableDeposits[l1Token] = l2Deposits.filter((l2Deposit) => !this.l1Client.hasL2DepositBeenRelayed(l2Deposit));
      if (relayableDeposits[l1Token].length == 0) delete relayableDeposits[l1Token];
    }
    if (Object.keys(relayableDeposits).length == 0) {
      this.logger.debug({ at: "Relayer", message: "No relayable deposits for any whitelisted tokens" });
      return;
    }
    for (const l1Token of Object.keys(relayableDeposits)) {
      this.logger.debug({ at: "Relayer", message: "Processing relayable deposits for L1Token", l1Token });
      for (const relayableDeposit of relayableDeposits[l1Token]) {
        const botL1TokenBalance = await this.fetchBotL1TokenBalance(l1Token);
        const relayType = this.shouldRelay(relayableDeposit, botL1TokenBalance);
        switch (relayType) {
          case RelayType.IgnoreRelay:
            this.logger.info({
              at: "Relayer",
              message: "Not relaying deposit 😖",
              l1Token,
              relayableDeposit,
              botL1TokenBalance,
            });
            break;
          case RelayType.Slow:
            this.logger.info({
              at: "Relayer",
              message: "Slow relaying deposit 🐌",
              l1Token,
              relayableDeposit,
              botL1TokenBalance,
            });
            await this.slowRelay(relayableDeposit);
            break;

          case RelayType.Fast:
            this.logger.info({
              at: "Relayer",
              message: "Fast relaying deposit 🏃‍♂️",
              l1Token,
              relayableDeposit,
              botL1TokenBalance,
            });
            await this.fastRelay(relayableDeposit);
            break;
        }
      }
    }
  }

  private shouldRelay(deposit: Deposit, botTokenBalance: string): RelayType {
    // shouldRelay(deposit) => RelayType { No, Slow, Fast }
    // Checks bot balance.
    // If bot balance is > transfer size, simulate the fast relay to determine the cost.
    // If bot balance is > bond, simulate the slow relay to determine the cost.
    // If the max profit across the two (or all that succeeded) is negative or 0, return No.
    // Else return the one with the most profit.

    // TODO: Add logic to decide if a relay action should happen
    console.log(deposit, botTokenBalance);
    return RelayType.Slow;
  }

  // TODO: implement these methods.
  private async slowRelay(deposit: Deposit) {
    console.log(deposit);
  }

  private async fastRelay(deposit: Deposit) {
    console.log(deposit);
  }

  private async fetchBotL1TokenBalance(l1TokenAddress: string): Promise<string> {
    const l1Token = (new this.web3.eth.Contract(
      getAbi("ExpandedERC20"),
      l1TokenAddress
    ) as unknown) as ExpandedERC20Web3;

    return await l1Token.methods.balanceOf(this.account).call();
  }
}
module.exports = { Relayer };
