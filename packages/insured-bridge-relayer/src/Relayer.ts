import winston from "winston";
import Web3 from "web3";
import type { BlockTransactionBase } from "web3-eth";
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
  SettleableRelay,
  BlockFinder,
} from "@uma/financial-templates-lib";
import { getTokenBalance } from "./RelayerHelpers";

import type { BN, TransactionType } from "@uma/common";

// Stores state of Relay (i.e. Pending, Uninitialized, Finalized) and linked L2 deposit parameters.
type RelayableDeposit = { status: ClientRelayState; deposit: Deposit };
// Key for RelayableDeposits is L1 token address.
type RelayableDeposits = { [key: string]: [RelayableDeposit] };

export enum RelaySubmitType {
  Slow,
  SpeedUp,
  Instant,
  Ignore,
}

export class Relayer {
  private readonly l2BlockFinder: BlockFinder<BlockTransactionBase>;

  /**
   * @notice Constructs new Relayer Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} l1Client Client for fetching L1 data from the insured bridge pool and admin contracts.
   * @param {Object} l2Client Client for fetching L2 deposit data.
   * @param {Array} whitelistedRelayL1Tokens List of whitelisted L1 tokens that the relayer supports.
   * @param {Array} whitelistedChainIds List of whitelisted chain IDs that the relayer supports. Any relays for chain
   * IDs not on this list will be disputed.
   * @param {string} account Unlocked web3 account to send L1 messages.
   * @param {number} l2LookbackWindow Used for last-resort block search for a missing deposit event. Should be same
   * period used by default in L2 client to find deposits.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly whitelistedRelayL1Tokens: string[],
    readonly account: string,
    readonly whitelistedChainIds: number[],
    // TODO: Deprecate `deployTimestamps` once BridgePools are upgraded and we can read `deployTimestamp` on-chain. For
    // now, we need to hardcode each BP's deploy timestamp.
    readonly deployTimestamps: { [key: string]: number },
    readonly l2LookbackWindow: number
  ) {
    this.l2BlockFinder = new BlockFinder<BlockTransactionBase>(this.l2Client.l2Web3.eth.getBlock);
  }

  async checkForPendingDepositsAndRelay(): Promise<void> {
    this.logger.debug({ at: "InsuredBridgeRelayer#Relayer", message: "Checking for pending deposits and relaying" });

    // Build dictionary of relayable deposits keyed by L1 tokens. We assume that getRelayableDeposits() filters
    // out Finalized relays.
    const relayableDeposits: RelayableDeposits = this.getRelayableDeposits();
    if (Object.keys(relayableDeposits).length == 0) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Relayer",
        message: "No relayable deposits for any whitelisted tokens",
      });
      return;
    }

    // Fetch pending relays (if any) for each relayable deposit and then decide whether to submit a relay (and what
    // type of relay) or dispute.
    for (const l1Token of Object.keys(relayableDeposits)) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Relayer",
        message: `Processing ${relayableDeposits[l1Token].length} relayable deposits for L1Token`,
        l1Token,
      });
      for (const relayableDeposit of relayableDeposits[l1Token]) {
        // If deposit quote time is before the bridgepool's deployment time, then skip it before attempting to calculate
        // the realized LP fee % as this will be impossible to query a contract for a timestamp before its deployment.
        if (relayableDeposit.deposit.quoteTimestamp < this.deployTimestamps[relayableDeposit.deposit.l1Token]) {
          this.logger.debug({
            at: "InsuredBridgeRelayer#Relayer",
            message: "Deposit quote time < bridge pool deployment for L1 token, skipping",
            deposit: relayableDeposit.deposit,
            deploymentTime: this.deployTimestamps[relayableDeposit.deposit.l1Token],
          });
          continue;
        }
        try {
          await this._relayPendingDeposit(l1Token, relayableDeposit);
        } catch (error) {
          this.logger.error({
            at: "InsuredBridgeRelayer#Relayer",
            message: "Unexpected error processing deposit",
            error,
          });
        }
      }
    }

    return;
  }

  async checkForPendingRelaysAndDispute(): Promise<void> {
    this.logger.debug({ at: "InsuredBridgeRelayer#Disputer", message: "Checking for pending relays and disputing" });

    // Build dictionary of pending relays keyed by l1 token and deposit hash. We assume that getPendingRelays() filters
    // out Finalized relays.
    const pendingRelays: Relay[] = this.getPendingRelays();
    if (pendingRelays.length == 0) {
      this.logger.debug({ at: "InsuredBridgeRelayer#Disputer", message: "No pending relays" });
      return;
    }
    this.logger.debug({
      at: "InsuredBridgeRelayer#Disputer",
      message: `Processing ${pendingRelays.length} pending relays`,
    });

    for (const relay of pendingRelays) {
      try {
        await this._disputePendingRelay(relay);
      } catch (error) {
        this.logger.error({
          at: "InsuredBridgeRelayer#Disputer",
          message: "Unexpected error processing relay",
          error,
        });
      }
    }

    return;
  }

  async checkforSettleableRelaysAndSettle(): Promise<void> {
    this.logger.debug({ at: "InsuredBridgeRelayer#Finalizer", message: "Checking for settleable relays and settling" });
    for (const l1Token of this.whitelistedRelayL1Tokens) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Finalizer",
        message: "Checking settleable relays for token",
        l1Token,
      });
      // Either this bot is the slow relayer for this relay OR the relay is past 15 mins and is settleable by anyone.
      const settleableRelays = this.l1Client
        .getSettleableRelayedDepositsForL1Token(l1Token)
        .filter(
          (relay) =>
            (relay.settleable === SettleableRelay.SlowRelayerCanSettle && relay.slowRelayer === this.account) ||
            relay.settleable === SettleableRelay.AnyoneCanSettle
        );

      if (settleableRelays.length == 0) {
        this.logger.debug({ at: "InsuredBridgeRelayer#Finalizer", message: "No settleable relays" });
        return;
      }

      for (const settleableRelay of settleableRelays) {
        try {
          await this.settleRelay(this.l2Client.getDepositByHash(settleableRelay.depositHash), settleableRelay);
        } catch (error) {
          this.logger.error({
            at: "InsuredBridgeRelayer#Finalizer",
            message: "Unexpected error processing relay",
            error,
          });
        }
      }
    }

    return;
  }

  // Evaluates given pending `relay` and determines whether to submit a dispute.
  private async _disputePendingRelay(relay: Relay): Promise<void> {
    // Check if relay has expired, in which case we cannot dispute.
    const relayExpired = await this.isRelayExpired(relay, relay.l1Token);
    if (relayExpired.isExpired) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Disputer",
        message: "Pending relay has expired, ignoring",
        relay,
        expirationTime: relayExpired.expirationTime,
        contractTime: relayExpired.contractTime,
      });
      return;
    }

    // If relay's chain ID is not whitelisted then dispute it.
    if (!this.whitelistedChainIds.includes(relay.chainId)) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Disputer",
        message: "Disputing pending relay with non-whitelisted chainID",
        relay,
      });
      await this.disputeRelay(
        {
          chainId: relay.chainId,
          depositId: relay.depositId,
          depositHash: relay.depositHash,
          l1Recipient: relay.l1Recipient,
          l2Sender: relay.l2Sender,
          l1Token: relay.l1Token,
          amount: relay.amount,
          slowRelayFeePct: relay.slowRelayFeePct,
          instantRelayFeePct: relay.instantRelayFeePct,
          quoteTimestamp: relay.quoteTimestamp,
          depositContract: (await this.l1Client.bridgeAdmin.methods.depositContracts(relay.chainId).call())[0],
          // `depositContracts()` returns [depositContract, messengerContract] and we want the first arg.
        },
        relay
      );
      return;
    }

    // We now know that the relay chain ID is whitelisted, so let's skip any relays for chain ID's that do not match
    // the L2 clients. We won't be able to query deposit data for these relays.
    if (relay.chainId !== this.l2Client.chainId) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Disputer",
        message: "Relay chain ID is whitelisted but does not match L2 client chain ID",
        l2ClientChainId: this.l2Client.chainId,
        relay,
      });
      return;
    }

    // Fetch deposit for relay.
    const deposit = await this.matchRelayWithDeposit(relay);

    // If Relay matchers a Deposit, then we need to validate whether the relay params are correct.
    if (
      deposit !== undefined &&
      deposit.chainId === relay.chainId &&
      deposit.depositHash === relay.depositHash &&
      deposit.l1Recipient === relay.l1Recipient &&
      deposit.l2Sender === relay.l2Sender &&
      deposit.l1Token === relay.l1Token &&
      deposit.amount === relay.amount &&
      deposit.slowRelayFeePct === relay.slowRelayFeePct &&
      deposit.instantRelayFeePct === relay.instantRelayFeePct &&
      deposit.quoteTimestamp === relay.quoteTimestamp
    ) {
      // Relay matched with a Deposit, now check if the relay params itself are valid.

      // If deposit quote time is before the bridgepool's deployment time, then dispute it by default because
      // we won't be able to determine otherwise if the realized LP fee % is valid.
      if (deposit.quoteTimestamp < this.deployTimestamps[deposit.l1Token]) {
        this.logger.debug({
          at: "Disputer",
          message: "Deposit quote time < bridge pool deployment for L1 token, disputing",
          deposit,
          deploymentTime: this.deployTimestamps[deposit.l1Token],
        });
        await this.disputeRelay(deposit, relay);
        return;
      }

      // Compute expected realized LP fee % and if the pending relay has a different fee then dispute it.
      const realizedLpFeePct = (await this.l1Client.calculateRealizedLpFeePctForDeposit(deposit)).toString();
      const relayDisputable = await this.isPendingRelayDisputable(relay, deposit, realizedLpFeePct);
      if (relayDisputable.canDispute) {
        this.logger.debug({
          at: "InsuredBridgeRelayer#Disputer",
          message: "Disputing pending relay with invalid params",
          relay,
          deposit,
          reason: relayDisputable.reason,
        });
        await this.disputeRelay(deposit, relay);
        return;
      } else {
        this.logger.debug({
          at: "InsuredBridgeRelayer#Disputer",
          message: "Skipping; relay matched with deposit and params are valid",
          relay,
          deposit,
        });
        return;
      }
    } else {
      // At this point, we can't match the relay with a deposit (even after a second block search), so we will
      // submit a dispute.
      const missingDeposit: Deposit = {
        chainId: relay.chainId,
        depositId: relay.depositId,
        depositHash: relay.depositHash,
        l1Recipient: relay.l1Recipient,
        l2Sender: relay.l2Sender,
        l1Token: relay.l1Token,
        amount: relay.amount,
        slowRelayFeePct: relay.slowRelayFeePct,
        instantRelayFeePct: relay.instantRelayFeePct,
        quoteTimestamp: relay.quoteTimestamp,
        depositContract: (await this.l1Client.bridgeAdmin.methods.depositContracts(relay.chainId).call())[0],
        // `depositContracts()` returns [depositContract, messengerContract] and we want the first arg.
      };
      this.logger.debug({
        at: "InsuredBridgeRelayer#Disputer",
        message: "Disputing pending relay with no matching deposit",
        missingDeposit,
        relay,
      });
      await this.disputeRelay(missingDeposit, relay);
      return;
    }
  }

  // Evaluates given `relayableDeposit` for the `l1Token` and determines whether to submit a slow or fast relay.
  private async _relayPendingDeposit(l1Token: string, relayableDeposit: RelayableDeposit): Promise<void> {
    const realizedLpFeePct = await this.l1Client.calculateRealizedLpFeePctForDeposit(relayableDeposit.deposit);

    const pendingRelay: Relay | undefined = this.l1Client.getRelayForDeposit(l1Token, relayableDeposit.deposit);
    if (pendingRelay) {
      // We need to perform some prechecks on the relay before we attempt to submit a relay. First, we need to check
      // if the relay has expired, for if it has then we cannot do anything with it except settle it. Second, we need
      // to check the pending relay's parameters (i.e. any data not included in the deposit hash) and verify that
      // they are correct. If they are not then we just ignore it as a potential speedup candidate.
      const relayExpired = await this.isRelayExpired(pendingRelay, pendingRelay.l1Token);
      if (relayExpired.isExpired) {
        this.logger.debug({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Pending relay has expired, ignoring",
          pendingRelay,
          relayableDeposit,
          expirationTime: relayExpired.expirationTime,
          contractTime: relayExpired.contractTime,
        });
        return;
      } else {
        const relayDisputable = await this.isPendingRelayDisputable(
          pendingRelay,
          relayableDeposit.deposit,
          realizedLpFeePct.toString()
        );
        if (relayDisputable.canDispute) {
          this.logger.debug({
            at: "InsuredBridgeRelayer#Relayer",
            message: "Pending relay is invalid",
            pendingRelay,
            relayableDeposit,
            reason: relayDisputable.reason,
          });
          return;
        }

        // If we reach here, then pending relay has not expired and its valid, so there is a chance we can speed it up.
      }
    }

    // Account for profitability and bot token balance when deciding how to relay.
    const hasInstantRelayer = this.l1Client.hasInstantRelayer(
      relayableDeposit.deposit.l1Token,
      relayableDeposit.deposit.depositHash,
      realizedLpFeePct.toString()
    );
    // If relay cannot occur because its pending and already sped up, then exit early.
    if (hasInstantRelayer && relayableDeposit.status == ClientRelayState.Pending) {
      this.logger.debug({
        at: "InsuredBridgeRelayer#Relayer",
        message: "Relay pending and already sped up 😖",
        realizedLpFeePct: realizedLpFeePct.toString(),
        relayState: relayableDeposit.status,
        hasInstantRelayer,
        relayableDeposit,
      });
      return;
    }
    const shouldRelay = await this.shouldRelay(
      relayableDeposit.deposit,
      relayableDeposit.status,
      realizedLpFeePct,
      hasInstantRelayer
    );

    // Depending on value of `shouldRelay`, send correct type of relay.
    await this.sendRelayTransaction(shouldRelay, realizedLpFeePct, relayableDeposit, pendingRelay, hasInstantRelayer);
    return;
  }

  // Only Relay-specific params need to be validated (i.e. those params in the Relay struct of BridgePool). If any
  // Deposit params are incorrect, then the BridgePool's computed deposit hash will be different and the relay won't be
  // found. So, assuming that the relay contains a matching deposit hash, this bot's job is to only consider speeding up
  // relays that are valid, otherwise the bot might lose money without recourse on the relay.

  private async isPendingRelayDisputable(
    relay: Relay,
    deposit: Deposit,
    expectedRelayRealizedLpFeePct: string
  ): Promise<{ canDispute: boolean; reason: string }> {
    const relayRealizedLpFeePct = relay.realizedLpFeePct.toString();
    if (relayRealizedLpFeePct !== expectedRelayRealizedLpFeePct)
      return {
        canDispute: true,
        reason: `relayRealizedLpFeePct: ${relayRealizedLpFeePct} != expectedRelayRealizedLpFeePct: ${expectedRelayRealizedLpFeePct}`,
      };
    return { canDispute: false, reason: "" };
  }

  private isRelayExpired(
    relay: Relay,
    l1Token: string
  ): { isExpired: boolean; expirationTime: number; contractTime: number } {
    const relayExpirationTime = relay.priceRequestTime + this.l1Client.optimisticOracleLiveness;
    const currentContractTime = this.l1Client.getBridgePoolForToken(l1Token).currentTime;
    return {
      isExpired: relay.settleable !== SettleableRelay.CannotSettle,
      expirationTime: relayExpirationTime,
      contractTime: currentContractTime,
    };
  }

  private async shouldRelay(
    deposit: Deposit,
    clientRelayState: ClientRelayState,
    realizedLpFeePct: BN,
    hasInstantRelayer: boolean
  ): Promise<RelaySubmitType> {
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

    // b) Balance is large enough to instant relay and the relay does not have an instant relayer. Deposit is in any state except finalized (i.e can be slow relayed
    // and sped up or only sped up.)
    if (
      !hasInstantRelayer &&
      l1TokenBalance.gte(relayTokenRequirement.instant) &&
      clientRelayState !== ClientRelayState.Finalized
    )
      speedUpProfit = toBN(deposit.amount).mul(toBN(deposit.instantRelayFeePct)).div(fixedPointAdjustment);

    // c) Balance is large enough to slow relay and then speed up. Only considered if no L1 action has happened yet as
    // wont be able to do an instant relay if the relay has already been slow relayed. In that case, should speedUp.
    if (
      l1TokenBalance.gte(relayTokenRequirement.slow.add(relayTokenRequirement.instant)) &&
      clientRelayState == ClientRelayState.Uninitialized
    )
      instantProfit = slowProfit.add(speedUpProfit);

    // Finally, decide what action to do based on the relative profits.
    if (instantProfit.gt(speedUpProfit) && instantProfit.gt(slowProfit)) return RelaySubmitType.Instant;

    if (speedUpProfit.gt(slowProfit)) return RelaySubmitType.SpeedUp;
    if (slowProfit.gt(toBN("0"))) return RelaySubmitType.Slow;
    return RelaySubmitType.Ignore;
  }

  private async slowRelay(deposit: Deposit, realizedLpFeePct: BN) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateSlowRelayTx(deposit, realizedLpFeePct),
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Slow Relay executed  🐌",
          tx: receipt.transactionHash,
          chainId: receipt.events.DepositRelayed.returnValues.depositData.chainId,
          depositId: receipt.events.DepositRelayed.returnValues.depositData.depositId,
          sender: receipt.events.DepositRelayed.returnValues.depositData.l2Sender,
          slowRelayer: receipt.events.DepositRelayed.returnValues.relay.slowRelayer,
          recipient: receipt.events.DepositRelayed.returnValues.depositData.l1Recipient,
          amount: receipt.events.DepositRelayed.returnValues.depositData.amount,
          slowRelayFeePct: receipt.events.DepositRelayed.returnValues.depositData.slowRelayFeePct,
          instantRelayFeePct: receipt.events.DepositRelayed.returnValues.depositData.instantRelayFeePct,
          quoteTimestamp: receipt.events.DepositRelayed.returnValues.depositData.quoteTimestamp,
          proposerBond: receipt.events.DepositRelayed.returnValues.relay.proposerBond,
          finalFee: receipt.events.DepositRelayed.returnValues.relay.finalFee,
          realizedLpFeePct: receipt.events.DepositRelayed.returnValues.relay.realizedLpFeePct,
          relayId: receipt.events.DepositRelayed.returnValues.relay.relayId,
          relayState: receipt.events.DepositRelayed.returnValues.relay.relayState,
          priceRequestTime: receipt.events.DepositRelayed.returnValues.relay.priceRequestTime,
          relayAncillaryDataHash: receipt.events.DepositRelayed.returnValues.relayAncillaryDataHash,
          depositHash: receipt.events.DepositRelayed.returnValues.depositHash,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", message: "Something errored slow relaying!", error });
    }
  }

  private async speedUpRelay(deposit: Deposit, relay: Relay) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateSpeedUpRelayTx(deposit, relay),
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Slow relay sped up 🏇",
          tx: receipt.transactionHash,
          depositHash: receipt.events.RelaySpedUp.returnValues.depositHash,
          instantRelayer: receipt.events.RelaySpedUp.returnValues.instantRelayer,
          proposerBond: receipt.events.RelaySpedUp.returnValues.relay.proposerBond,
          finalFee: receipt.events.RelaySpedUp.returnValues.relay.finalFee,
          realizedLpFeePct: receipt.events.RelaySpedUp.returnValues.relay.realizedLpFeePct,
          relayId: receipt.events.RelaySpedUp.returnValues.relay.relayId,
          relayState: receipt.events.RelaySpedUp.returnValues.relay.relayState,
          priceRequestTime: receipt.events.RelaySpedUp.returnValues.relay.priceRequestTime,
          slowRelayer: receipt.events.RelaySpedUp.returnValues.relay.slowRelayer,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Relayer", message: "Something errored speeding up relay!", error });
    }
  }

  private async instantRelay(deposit: Deposit, realizedLpFeePct: BN) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateInstantRelayTx(deposit, realizedLpFeePct),
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });
      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Relay instantly sent 🚀",
          tx: receipt.transactionHash,
          chainId: receipt.events.DepositRelayed.returnValues.depositData.chainId,
          depositId: receipt.events.DepositRelayed.returnValues.depositData.depositId,
          sender: receipt.events.DepositRelayed.returnValues.depositData.l2Sender,
          recipient: receipt.events.DepositRelayed.returnValues.depositData.l1Recipient,
          amount: receipt.events.DepositRelayed.returnValues.depositData.amount,
          slowRelayFeePct: receipt.events.DepositRelayed.returnValues.depositData.slowRelayFeePct,
          instantRelayFeePct: receipt.events.DepositRelayed.returnValues.depositData.instantRelayFeePct,
          quoteTimestamp: receipt.events.DepositRelayed.returnValues.depositData.quoteTimestamp,
          relayAncillaryDataHash: receipt.events.DepositRelayed.returnValues.relayAncillaryDataHash,
          proposerBond: receipt.events.DepositRelayed.returnValues.relay.proposerBond,
          finalFee: receipt.events.DepositRelayed.returnValues.relay.finalFee,
          depositHash: receipt.events.RelaySpedUp.returnValues.depositHash,
          instantRelayer: receipt.events.RelaySpedUp.returnValues.instantRelayer,
          realizedLpFeePct: receipt.events.RelaySpedUp.returnValues.relay.realizedLpFeePct,
          relayId: receipt.events.RelaySpedUp.returnValues.relay.relayId,
          relayState: receipt.events.RelaySpedUp.returnValues.relay.relayState,
          priceRequestTime: receipt.events.RelaySpedUp.returnValues.relay.priceRequestTime,
          slowRelayer: receipt.events.RelaySpedUp.returnValues.relay.slowRelayer,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({
        at: "InsuredBridgeRelayer#Relayer",
        message: "Something errored instantly relaying!",
        error,
      });
    }
  }

  private async settleRelay(deposit: Deposit, relay: Relay) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateSettleRelayTx(deposit, relay),
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });
      if (receipt.events)
        this.logger.info({
          at: "InsuredBridgeRelayer#Finalizer",
          message: "Relay settled 💸",
          tx: receipt.transactionHash,
          depositHash: receipt.events.RelaySettled.returnValues.depositHash,
          caller: receipt.events.RelaySettled.returnValues.caller,
          realizedLpFeePct: receipt.events.RelaySettled.returnValues.relay.realizedLpFeePct,
          proposerBond: receipt.events.RelaySettled.returnValues.relay.proposerBond,
          finalFee: receipt.events.RelaySettled.returnValues.relay.finalFee,
          relayId: receipt.events.RelaySettled.returnValues.relay.relayId,
          relayState: receipt.events.RelaySettled.returnValues.relay.relayState,
          priceRequestTime: receipt.events.RelaySettled.returnValues.relay.priceRequestTime,
          slowRelayer: receipt.events.RelaySettled.returnValues.relay.slowRelayer,
          transactionConfig,
        });
      else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Finalizer", message: "Something errored settling relay!", error });
    }
  }

  private async disputeRelay(deposit: Deposit, relay: Relay) {
    await this.gasEstimator.update();
    try {
      const { receipt, transactionConfig } = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: this.generateDisputeRelayTx(deposit, relay),
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });

      if (receipt.events) {
        if (receipt.events.RelayDisputed) {
          this.logger.info({
            at: "InsuredBridgeRelayer#Disputer",
            message: "Disputed pending relay. Relay was deleted. 🚓",
            tx: receipt.transactionHash,
            depositHash: receipt.events.RelayDisputed.returnValues.depositHash,
            relayHash: receipt.events.RelayDisputed.returnValues.relayHash,
            disputer: receipt.events.RelayDisputed.returnValues.disputer,
            transactionConfig,
          });
        } else if (receipt.events.RelayCanceled) {
          this.logger.info({
            at: "InsuredBridgeRelayer#Disputer",
            message: "Dispute failed to send to OO. Relay was deleted. 🚓",
            tx: receipt.transactionHash,
            depositHash: receipt.events.RelayCanceled.returnValues.depositHash,
            relayHash: receipt.events.RelayCanceled.returnValues.relayHash,
            disputer: receipt.events.RelayCanceled.returnValues.disputer,
            transactionConfig,
          });
        } else throw receipt;
      } else throw receipt;
    } catch (error) {
      this.logger.error({ at: "InsuredBridgeRelayer#Disputer", message: "Something errored disputing relay!", error });
    }
  }

  private generateSlowRelayTx(deposit: Deposit, realizedLpFeePct: BN): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForToken(deposit.l1Token).contract;
    return (bridgePool.methods.relayDeposit(
      [
        deposit.chainId,
        deposit.depositId,
        deposit.l1Recipient,
        deposit.l2Sender,
        deposit.amount,
        deposit.slowRelayFeePct,
        deposit.instantRelayFeePct,
        deposit.quoteTimestamp,
      ],
      realizedLpFeePct
    ) as unknown) as TransactionType;
  }

  private generateSpeedUpRelayTx(deposit: Deposit, relay: Relay): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForToken(deposit.l1Token).contract;
    return (bridgePool.methods.speedUpRelay(deposit as any, relay as any) as unknown) as TransactionType;
  }

  private generateInstantRelayTx(deposit: Deposit, realizedLpFeePct: BN): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForToken(deposit.l1Token).contract;
    return (bridgePool.methods.relayAndSpeedUp(
      deposit as any,
      realizedLpFeePct.toString()
    ) as unknown) as TransactionType;
  }

  private generateDisputeRelayTx(deposit: Deposit, relay: Relay): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForToken(deposit.l1Token).contract;
    return (bridgePool.methods.disputeRelay(deposit as any, relay as any) as unknown) as TransactionType;
  }

  private generateSettleRelayTx(deposit: Deposit, relay: Relay): TransactionType {
    const bridgePool = this.l1Client.getBridgePoolForToken(deposit.l1Token).contract;
    type ContractDepositArg = Parameters<typeof bridgePool["methods"]["settleRelay"]>[0];
    return (bridgePool.methods.settleRelay(
      (deposit as unknown) as ContractDepositArg,
      relay as any
    ) as unknown) as TransactionType;
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

  // Return fresh dictionary of relayable deposits keyed by the L1 token to be sent to recipient.
  private getRelayableDeposits(): RelayableDeposits {
    const relayableDeposits: RelayableDeposits = {};
    for (const l1Token of this.whitelistedRelayL1Tokens) {
      this.logger.debug({ at: "InsuredBridgeRelayer#Relayer", message: "Checking relays for token", l1Token });
      const l2Deposits = this.l2Client.getAllDepositsForL1Token(l1Token);
      l2Deposits.forEach((deposit) => {
        const status = this.l1Client.getDepositRelayState(deposit);
        if (status != ClientRelayState.Finalized) {
          if (!relayableDeposits[l1Token]) relayableDeposits[l1Token] = [{ status, deposit }];
          else relayableDeposits[l1Token].push({ status, deposit });
        }
      });
    }
    return relayableDeposits;
  }

  private getPendingRelays(): Relay[] {
    return this.l1Client.getPendingRelayedDeposits();
  }

  // Send correct type of relay along with parameters to submit transaction.
  private async sendRelayTransaction(
    shouldRelay: RelaySubmitType,
    realizedLpFeePct: BN,
    relayableDeposit: RelayableDeposit,
    pendingRelay: Relay | undefined,
    hasInstantRelayer: boolean
  ) {
    switch (shouldRelay) {
      case RelaySubmitType.Ignore:
        this.logger.debug({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Not relaying potentially unprofitable deposit, or insufficient balance 😖",
          realizedLpFeePct: realizedLpFeePct.toString(),
          relayState: relayableDeposit.status,
          hasInstantRelayer,
          relayableDeposit,
        });
        break;
      case RelaySubmitType.Slow:
        this.logger.debug({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Slow relaying deposit",
          realizedLpFeePct: realizedLpFeePct.toString(),
          relayableDeposit,
        });
        await this.slowRelay(relayableDeposit.deposit, realizedLpFeePct);
        break;

      case RelaySubmitType.SpeedUp:
        this.logger.debug({
          at: "InsuredBridgeRelayer#Relayer",
          message: "Speeding up existing relayed deposit",
          realizedLpFeePct: realizedLpFeePct.toString(),
          relayableDeposit,
        });
        if (pendingRelay === undefined)
          // The `pendingRelay` should never be undefined if shouldRelay returns SpeedUp, but we have to catch the
          // undefined type that is returned by the L1 client method.
          this.logger.error({ at: "InsuredBridgeRelayer#Relayer", message: "speedUpRelay: undefined relay" });
        else await this.speedUpRelay(relayableDeposit.deposit, pendingRelay);
        break;
      case RelaySubmitType.Instant:
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

  // Return unique deposit event matching relay
  private async matchRelayWithDeposit(relay: Relay): Promise<Deposit | undefined> {
    // First try to fetch deposit from the L2 client's default block search config. This should work in most cases.
    let deposit: Deposit | undefined = this.l2Client.getDepositByHash(relay.depositHash);
    if (deposit !== undefined) return deposit;
    // We could not find a deposit using the L2 client's default block search config. Next, we'll modify the block
    // search config bridge pool's deployment time. This allows us to capture any deposits that happened outside of
    // the L2 client's default block search config.
    else {
      const bridgePoolDeploymentTime = (
        await this.l2BlockFinder.getBlockForTimestamp(this.deployTimestamps[relay.l1Token])
      ).number;
      let blockSearchConfig = {
        fromBlock: bridgePoolDeploymentTime,
        toBlock: bridgePoolDeploymentTime + this.l2LookbackWindow,
      };
      const latestBlock = Number((await this.l2Client.l2Web3.eth.getBlock("latest")).number);

      // Look up all blocks from contract deployment time to latest to ensure that a deposit, if it exists, is found.
      while (deposit === undefined) {
        const [fundsDepositedEvents] = await Promise.all([
          this.l2Client.bridgeDepositBox.getPastEvents("FundsDeposited", blockSearchConfig),
        ]);
        // For any found deposits, try to match it with the relay:
        for (const fundsDepositedEvent of fundsDepositedEvents) {
          const _deposit: Deposit = {
            chainId: Number(fundsDepositedEvent.returnValues.chainId),
            depositId: Number(fundsDepositedEvent.returnValues.depositId),
            depositHash: "", // Filled in after initialization of the remaining variables.
            l1Recipient: fundsDepositedEvent.returnValues.l1Recipient,
            l2Sender: fundsDepositedEvent.returnValues.l2Sender,
            l1Token: fundsDepositedEvent.returnValues.l1Token,
            amount: fundsDepositedEvent.returnValues.amount,
            slowRelayFeePct: fundsDepositedEvent.returnValues.slowRelayFeePct,
            instantRelayFeePct: fundsDepositedEvent.returnValues.instantRelayFeePct,
            quoteTimestamp: Number(fundsDepositedEvent.returnValues.quoteTimestamp),
            depositContract: fundsDepositedEvent.address,
          };
          _deposit.depositHash = this.l2Client.generateDepositHash(_deposit);
          if (_deposit.depositHash === relay.depositHash) {
            this.logger.debug({
              at: "InsuredBridgeRelayer#Disputer",
              message: "Matched deposit using relay quote time to run new block search",
              blockSearchConfig,
              deposit,
              relay,
            });
            deposit = _deposit;
            break;
          }
        }

        // Exit loop if block search encompasses "latest" block number. Breaking the loop here guarantees that the
        // above event search executes at least once.
        if (blockSearchConfig.toBlock >= latestBlock) break;

        // Increment block search.
        blockSearchConfig = {
          fromBlock: blockSearchConfig.toBlock,
          toBlock: Math.min(latestBlock, blockSearchConfig.toBlock + this.l2LookbackWindow),
        };
      }
    }

    return deposit;
  }
}
