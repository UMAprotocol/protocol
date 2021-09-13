import winston from "winston";
import Web3 from "web3";
const { toWei, toBN } = Web3.utils;
const fixedPointAdjustment = toBN(toWei("1"));

import { runTransaction } from "@uma/common";
import {
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  GasEstimator,
  Deposit,
  RelayAbility,
} from "@uma/financial-templates-lib";
import { getTokenBalance } from "./RelayerHelpers";

import type { BN, TransactionType } from "@uma/common";

export enum RelayType {
  Slow,
  SpeedUp,
  Instant,
  Ignore,
}

export class Relayer {
  /**
   * @notice Constructs new Relayer Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} l1Client Client for fetching L1 data from the insured bridge pool and admin contracts.
   * @param {Object} l2Client Client for fetching L2 deposit data.
   * @param {Array} whitelistedRelayL1Tokens List of whitelisted L1 tokens that the relayer supports.
   * @param {string} account Unlocked web3 account to send L1 messages.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly whitelistedRelayL1Tokens: string[],
    readonly account: string
  ) {}

  // TODO: consider refactoring this further into multiple methods. One to build the object of relayableDeposits and one
  // that processes relayableDeposits and calls respective relaying functions.
  async checkForPendingDepositsAndRelay() {
    this.logger.debug({ at: "Relayer", message: "Checking for pending deposits and relaying" });
    const relayableDeposits: { [key: string]: [{ status: RelayAbility; deposit: Deposit }] } = {};
    for (const l1Token of this.whitelistedRelayL1Tokens) {
      this.logger.debug({ at: "Relayer", message: "Checking relays for token", l1Token });
      // TODO: consider limiting how far back we look in this call size.
      const l2Deposits = this.l2Client.getAllDeposits();
      l2Deposits.forEach((deposit) => {
        const status = this.l1Client.getDepositRelayAbility(deposit);
        if (status != RelayAbility.None) {
          if (!relayableDeposits[l1Token]) relayableDeposits[l1Token] = [{ status, deposit }];
          else relayableDeposits[l1Token].push({ status, deposit });
        }
      });
    }
    if (Object.keys(relayableDeposits).length == 0) {
      this.logger.debug({ at: "Relayer", message: "No relayable deposits for any whitelisted tokens" });
      return;
    }
    for (const l1Token of Object.keys(relayableDeposits)) {
      this.logger.debug({ at: "Relayer", message: "Processing relayable deposits for L1Token", l1Token });
      for (const relayableDeposit of relayableDeposits[l1Token]) {
        const realizedLpFeePct = await this.l1Client.calculateRealizedLpFeePctForDeposit(relayableDeposit.deposit);
        const desiredRelayType = await this.shouldRelay(
          relayableDeposit.deposit,
          relayableDeposit.status,
          realizedLpFeePct
        );
        switch (desiredRelayType) {
          case RelayType.Ignore:
            this.logger.warn({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Not relaying deposit 😖",
              realizedLpFeePct,
              relayableDeposit,
            });
            break;
          case RelayType.Slow:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Slow relaying deposit",
              realizedLpFeePct,
              relayableDeposit,
            });
            await this.slowRelay(relayableDeposit.deposit, realizedLpFeePct);
            break;

          case RelayType.SpeedUp:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Speeding up existing relayed deposit",
              realizedLpFeePct,
              relayableDeposit,
            });
            await this.speedUpRelay(relayableDeposit.deposit);
            break;
          case RelayType.Instant:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Instant relaying deposit",
              realizedLpFeePct,
              relayableDeposit,
            });
            await this.instantRelay(relayableDeposit.deposit);
            break;
        }
      }
    }
  }

  private async shouldRelay(deposit: Deposit, relayAbility: RelayAbility, realizedLpFeePct: BN): Promise<RelayType> {
    const [l1TokenBalance, proposerBondPct] = await Promise.all([
      getTokenBalance(this.l1Client.l1Web3, deposit.l1Token, this.account),
      this.l1Client.getProposerBondPct(),
    ]);
    const relayTokenRequirement = this.getRelayTokenRequirement(deposit, proposerBondPct, realizedLpFeePct);

    // There are three different kinds of profits that the bot can produce:
    let slowProfit = toBN("0");
    let speedUpProfit = toBN("0");
    let instantProfit = toBN("0");
    // Based on the bots token balance, and the relay state we can compute the profitability of each action.

    // a) Balance is large enough to do a slow relay. No relay action has happened on L1 yet for this deposit.
    if (l1TokenBalance.gte(relayTokenRequirement.slow) && relayAbility === RelayAbility.Any)
      slowProfit = toBN(deposit.amount).mul(toBN(deposit.slowRelayFeePct)).div(fixedPointAdjustment);

    // b) Balance is large enough to instant relay. Deposit is in any state except finalized (i.e can be slow relayed
    // and sped up or only sped up.)
    if (l1TokenBalance.gte(relayTokenRequirement.instant) && relayAbility !== RelayAbility.None)
      speedUpProfit = toBN(deposit.amount).mul(toBN(deposit.instantRelayFeePct)).div(fixedPointAdjustment);

    // c) Balance is large enough to slow relay and then speed up. Only considered if no L1 action has happened yet as
    // wont be able to do an instant relay if the relay has already been slow relayed. In that case, should speedUp.
    if (
      l1TokenBalance.gte(relayTokenRequirement.slow.add(relayTokenRequirement.instant)) &&
      relayAbility == RelayAbility.Any
    )
      instantProfit = slowProfit.add(speedUpProfit);

    // Finally, decide what action to do based on the relative profits.
    if (instantProfit.gt(speedUpProfit) && instantProfit.gt(slowProfit)) return RelayType.Instant;
    if (speedUpProfit.gt(slowProfit)) return RelayType.SpeedUp;
    if (slowProfit.gt(toBN("0"))) return RelayType.Slow;
    return RelayType.Ignore;
  }

  private async slowRelay(deposit: Deposit, realizedLpFee: BN) {
    const bridgePool = this.l1Client.getBridgePoolForDeposit(deposit);
    const slowRelayTx = bridgePool.methods.relayDeposit(
      deposit.depositId,
      deposit.timestamp,
      deposit.recipient,
      deposit.sender,
      deposit.amount,
      deposit.slowRelayFeePct,
      deposit.instantRelayFeePct,
      deposit.quoteTimestamp,
      realizedLpFee
    );

    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: (slowRelayTx as unknown) as TransactionType,
        transactionConfig: { gasPrice: this.gasEstimator.getCurrentFastPrice().toString(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          type: "Slow Relay executed  🐌",
          tx: receipt.transactionHash,
          depositId: receipt.events.DepositRelayed.returnValues.depositId,
          sender: receipt.events.DepositRelayed.returnValues.sender,
          slowRelayer: receipt.events.DepositRelayed.returnValues.slowRelayer,
          depositTimestamp: receipt.events.DepositRelayed.returnValues.depositTimestamp,
          recipient: receipt.events.DepositRelayed.returnValues.recipient,
          l1Token: receipt.events.DepositRelayed.returnValues.l1Token,
          amount: receipt.events.DepositRelayed.returnValues.amount,
          slowRelayFeePct: receipt.events.DepositRelayed.returnValues.slowRelayFeePct,
          instantRelayFeePct: receipt.events.DepositRelayed.returnValues.instantRelayFeePct,
          quoteTimestamp: receipt.events.DepositRelayed.returnValues.quoteTimestamp,
          realizedLpFeePct: receipt.events.DepositRelayed.returnValues.realizedLpFeePct,
          priceRequestAncillaryDataHash: receipt.events.DepositRelayed.returnValues.priceRequestAncillaryDataHash,
          depositHash: receipt.events.DepositRelayed.returnValues.depositHash,
          depositContract: receipt.events.DepositRelayed.returnValues.depositContract,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", type: "Something went wrong slow relaying!", error });
    }
  }

  private async speedUpRelay(/* deposit: Deposit*/) {
    // TODO: implement
  }

  private async instantRelay(/* deposit: Deposit*/) {
    // TODO: implement
  }

  private getRelayTokenRequirement(
    deposit: Deposit,
    proposerBondPct: BN,
    realizedLpFeePct: BN
  ): { slow: BN; instant: BN } {
    // bridged amount - the LP fee, - slow relay fee, - instant relay fee
    return {
      slow: toBN(deposit.amount).mul(proposerBondPct).muln(2).div(fixedPointAdjustment),
      instant: toBN(deposit.amount)
        .mul(
          toBN(toWei("1"))
            .sub(realizedLpFeePct)
            .sub(toBN(deposit.slowRelayFeePct))
            .sub(toBN(deposit.instantRelayFeePct))
        )
        .div(fixedPointAdjustment),
    };
  }
}
