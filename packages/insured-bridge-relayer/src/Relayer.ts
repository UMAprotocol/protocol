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
  Relay,
  ClientRelayState,
} from "@uma/financial-templates-lib";
import { getTokenBalance } from "./RelayerHelpers";

import type { BN, TransactionType } from "@uma/common";

export enum ShouldRelay {
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
    const relayableDeposits: { [key: string]: [{ status: ClientRelayState; deposit: Deposit }] } = {};
    for (const l1Token of this.whitelistedRelayL1Tokens) {
      this.logger.debug({ at: "Relayer", message: "Checking relays for token", l1Token });
      // TODO: consider limiting how far back we look in this call size.
      const l2Deposits = this.l2Client.getAllDeposits();
      l2Deposits.forEach((deposit) => {
        const status = this.l1Client.getDepositRelayState(deposit);
        if (status != ClientRelayState.Finalized) {
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
      this.logger.debug({
        at: "Relayer",
        message: `Processing ${relayableDeposits[l1Token].length} relayable deposits for L1Token`,
        l1Token,
      });
      for (const relayableDeposit of relayableDeposits[l1Token]) {
        // If deposit has a pending relay, then validate its relay params (i.e. any data not included in the deposit
        // hash). If relay params are invalid, then we should skip it so that we don't speed up an invalid relay.
        // If we cannot find the relay, then we should not skip it because we can still slow/instant relay it.
        const pendingRelay: Relay | undefined = this.l1Client.getRelayForDeposit(l1Token, relayableDeposit.deposit);
        if (pendingRelay) {
          const isRelayValid = await this.isRelayValid(pendingRelay, relayableDeposit.deposit);
          if (!isRelayValid.isValid) {
            this.logger.debug({
              at: "Relayer",
              message: "Pending relay is invalid, ignoring",
              pendingRelay,
              relayableDeposit,
              reason: isRelayValid.reason,
            });
            continue;
          }
        }
        // If relay is valid, then account for profitability and bot token balance when deciding how to relay.
        const realizedLpFeePct = await this.l1Client.calculateRealizedLpFeePctForDeposit(relayableDeposit.deposit);
        const shouldRelay = await this.shouldRelay(relayableDeposit.deposit, relayableDeposit.status, realizedLpFeePct);
        switch (shouldRelay) {
          case ShouldRelay.Ignore:
            this.logger.warn({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Not relaying deposit 😖",
              realizedLpFeePct: realizedLpFeePct.toString(),
              relayableDeposit,
            });
            break;
          case ShouldRelay.Slow:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Slow relaying deposit",
              realizedLpFeePct: realizedLpFeePct.toString(),
              relayableDeposit,
            });
            await this.slowRelay(relayableDeposit.deposit, realizedLpFeePct);
            break;

          case ShouldRelay.SpeedUp:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Speeding up existing relayed deposit",
              realizedLpFeePct: realizedLpFeePct.toString(),
              relayableDeposit,
            });
            await this.speedUpRelay(relayableDeposit.deposit);
            break;
          case ShouldRelay.Instant:
            this.logger.debug({
              at: "InsuredBridgeRelayer#Relayer",
              message: "Instant relaying deposit",
              realizedLpFeePct: realizedLpFeePct.toString(),
              relayableDeposit,
            });
            await this.instantRelay(relayableDeposit.deposit, realizedLpFeePct);
            break;
        }
      }
    }
  }

  // Only Relay-specific params need to be validated (i.e. those params in the Relay struct of BridgePool). If any
  // Deposit params are incorrect, then the BridgePool's computed deposit hash will be different and the relay won't be
  // found. So, assuming that the relay contains a matching deposit hash, this bot's job is to only consider speeding up
  // relays that are valid, otherwise the bot might lose money without recourse on the relay.

  private async isRelayValid(relay: Relay, deposit: Deposit): Promise<boolean> {
    return (
      relay.realizedLpFeePct.toString() ===
      (await this.l1Client.calculateRealizedLpFeePctForDeposit(deposit)).toString()
    );
  }

  private async shouldRelay(
    deposit: Deposit,
    clientRelayState: ClientRelayState,
    realizedLpFeePct: BN
  ): Promise<ShouldRelay> {
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
    if (l1TokenBalance.gte(relayTokenRequirement.slow) && clientRelayState === ClientRelayState.Uninitialized)
      slowProfit = toBN(deposit.amount).mul(toBN(deposit.slowRelayFeePct)).div(fixedPointAdjustment);

    // b) Balance is large enough to instant relay. Deposit is in any state except finalized (i.e can be slow relayed
    // and sped up or only sped up.)
    if (l1TokenBalance.gte(relayTokenRequirement.instant) && clientRelayState !== ClientRelayState.Finalized)
      speedUpProfit = toBN(deposit.amount).mul(toBN(deposit.instantRelayFeePct)).div(fixedPointAdjustment);

    // c) Balance is large enough to slow relay and then speed up. Only considered if no L1 action has happened yet as
    // wont be able to do an instant relay if the relay has already been slow relayed. In that case, should speedUp.
    if (
      l1TokenBalance.gte(relayTokenRequirement.slow.add(relayTokenRequirement.instant)) &&
      clientRelayState == ClientRelayState.Uninitialized
    )
      instantProfit = slowProfit.add(speedUpProfit);

    // Finally, decide what action to do based on the relative profits.
    if (instantProfit.gt(speedUpProfit) && instantProfit.gt(slowProfit)) return ShouldRelay.Instant;

    if (speedUpProfit.gt(slowProfit)) return ShouldRelay.SpeedUp;
    if (slowProfit.gt(toBN("0"))) return ShouldRelay.Slow;
    return ShouldRelay.Ignore;
  }

  private async slowRelay(deposit: Deposit, realizedLpFeePct: BN) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateSlowRelayTx(deposit, realizedLpFeePct),
        transactionConfig: { gasPrice: this.gasEstimator.getCurrentFastPrice().toString(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          type: "Slow Relay executed  🐌",
          tx: receipt.transactionHash,
          chainId: receipt.events.DepositRelayed.returnValues.chainId,
          depositId: receipt.events.DepositRelayed.returnValues.depositId,
          sender: receipt.events.DepositRelayed.returnValues.sender,
          slowRelayer: receipt.events.DepositRelayed.returnValues.slowRelayer,
          recipient: receipt.events.DepositRelayed.returnValues.recipient,
          l1Token: receipt.events.DepositRelayed.returnValues.l1Token,
          amount: receipt.events.DepositRelayed.returnValues.amount,
          slowRelayFeePct: receipt.events.DepositRelayed.returnValues.slowRelayFeePct,
          instantRelayFeePct: receipt.events.DepositRelayed.returnValues.instantRelayFeePct,
          quoteTimestamp: receipt.events.DepositRelayed.returnValues.quoteTimestamp,
          realizedLpFeePct: receipt.events.DepositRelayed.returnValues.realizedLpFeePct,
          depositHash: receipt.events.DepositRelayed.returnValues.depositHash,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", type: "Something errored slow relaying!", error });
    }
  }

  private async speedUpRelay(deposit: Deposit) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateSpeedUpRelayTx(deposit),
        transactionConfig: { gasPrice: this.gasEstimator.getCurrentFastPrice().toString(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          type: "Slow relay sped up 🏇",
          tx: receipt.transactionHash,
          depositHash: receipt.events.RelaySpedUp.returnValues.depositHash,
          instantRelayer: receipt.events.RelaySpedUp.returnValues.instantRelayer,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", type: "Something errored instantly relaying!", error });
    }
  }

  private async instantRelay(deposit: Deposit, realizedLpFeePct: BN) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateInstantRelayTx(deposit, realizedLpFeePct),
        transactionConfig: { gasPrice: this.gasEstimator.getCurrentFastPrice().toString(), from: this.account },
        availableAccounts: 1,
      });
      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          type: "Relay instantly sent 🚀",
          tx: receipt.transactionHash,
          depositHash: receipt.events.RelaySpedUp.returnValues.depositHash,
          instantRelayer: receipt.events.RelaySpedUp.returnValues.instantRelayer,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", type: "Something errored instantly relaying!", error });
    }
  }

  private generateSlowRelayTx(deposit: Deposit, realizedLpFeePct: BN): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForDeposit(deposit);
    return (bridgePool.methods.relayDeposit(
      deposit.chainId,
      deposit.depositId,
      deposit.l1Recipient,
      deposit.l2Sender,
      deposit.amount,
      deposit.slowRelayFeePct,
      deposit.instantRelayFeePct,
      deposit.quoteTimestamp,
      realizedLpFeePct
    ) as unknown) as TransactionType;
  }

  private generateSpeedUpRelayTx(deposit: Deposit): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForDeposit(deposit);
    return (bridgePool.methods.speedUpRelay(deposit as any) as unknown) as TransactionType;
  }

  private generateInstantRelayTx(deposit: Deposit, realizedLpFeePct: BN): TransactionType {
    const slowRelayTx = this.generateSlowRelayTx(deposit, realizedLpFeePct);
    const instantRelayTx = this.generateSpeedUpRelayTx(deposit);

    const bridgePool = this.l1Client.getBridgePoolForDeposit(deposit);
    return (bridgePool.methods.multicall([
      slowRelayTx.encodeABI(),
      instantRelayTx.encodeABI(),
    ]) as unknown) as TransactionType;
  }

  private getRelayTokenRequirement(
    deposit: Deposit,
    proposerBondPct: BN,
    realizedLpFeePct: BN
  ): { slow: BN; instant: BN } {
    return {
      // slow relay: proposer bond = amount * proposerBondPct
      slow: toBN(deposit.amount).mul(proposerBondPct).div(fixedPointAdjustment),
      // instant relay :amount - LP fee, - slow fee, - instant fee = amount * (1-lpFeePct+slowRelayFeePct+instantRelayFeePct)
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
