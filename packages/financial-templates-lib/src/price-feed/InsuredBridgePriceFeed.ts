import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { BN } from "../types";
import type { Logger } from "winston";
import { InsuredBridgeL1Client, Relay } from "../clients/InsuredBridgeL1Client";
import { InsuredBridgeL2Client, Deposit } from "../clients/InsuredBridgeL2Client";

const { toBN, toWei } = Web3.utils;

enum isRelayValid {
  No, // Should be 0
  Yes, // Should be 1
}

interface Params {
  logger: Logger;
  web3: Web3;
  l1Client: InsuredBridgeL1Client;
  l2Client: InsuredBridgeL2Client;
}

// Allows user to respond to a "relay" price request that was sent in response to a "deposit" on a InsuredBridge
// deployed to an L2 network. The relay price request is submitted on L1. This pricefeed will respond "Yes" or "No"
// based on whether the relay was correctly constructed to match a deposit. The price request includes parameters in
// its ancillary data that must be parsed from the hex ancillary data.
export class InsuredBridgePriceFeed extends PriceFeedInterface {
  private readonly decimals: number;
  private readonly logger: Logger;
  private readonly web3: Web3;
  private readonly l1Client: InsuredBridgeL1Client;
  private readonly l2Client: InsuredBridgeL2Client;
  private relays: Relay[] = [];
  private deposits: Deposit[] = [];
  private readonly toBNWei: (_number: number) => BN;

  /**
   * @notice Constructs the InsuredBridgePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider to connect to Ethereum network.
   * @param {Object} l1Client Fetches and returns latest state of L1 pool and admin contracts.
   * @param {Object} l2Client Fetches and returns latest state of L2 deposit contract.
   */
  constructor({ logger, web3, l1Client, l2Client }: Params) {
    super();

    this.decimals = 18;
    this.logger = logger;
    this.web3 = web3;
    this.l1Client = l1Client;
    this.l2Client = l2Client;
    this.toBNWei = (_number) => toBN(toWei(_number.toString()));
  }

  // This method returns the validity of a relay price request attempt. The relay request was valid if and only if it:
  // (1) corresponds with an L1 relay transaction submitted to the appropriate BridgePool contract and
  // (2) the L1 relay corresponds with an L2 deposit transaction submitted to the appropriate DepositBox contract.
  // If the relay request does not meet these conditions, then this method will return a price of 0, implying "No, the
  // relay was not valid".

  // For example, if a malicious actor were to submit a price request directly to the Optimistic
  // Oracle using the Insured Bridge identifier, then this method would return a price of 0 since there was no
  // associated relay for the price request.
  public async getHistoricalPrice(time: number | string): Promise<BN> {
    const matchedRelays = this.relays.filter((relay: Relay) => relay.relayTimestamp === time);
    if (matchedRelays.length > 1) {
      this.logger.error({
        at: "InsuredBridgePriceFeed",
        message: "TODO: Handle multiple relays for same price request timestamp",
        priceRequestTime: time,
      });
      throw new Error("TODO: Handle multiple relays for same price request timestamp");
    } else if (matchedRelays.length === 0) {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "No relay event found for price request time",
        priceRequestTime: time,
      });
      return this.toBNWei(isRelayValid.No);
    }

    const relay = matchedRelays[0];

    // Validate that relay matches a deposit struct exactly.
    const matchedDeposits = this.deposits.filter(
      (deposit: Deposit) =>
        deposit.depositId === relay.depositId &&
        deposit.depositHash === relay.depositHash &&
        deposit.timestamp === relay.depositTimestamp &&
        deposit.sender === relay.sender &&
        deposit.recipient === relay.recipient &&
        deposit.l1Token === relay.l1Token &&
        deposit.amount === relay.amount &&
        deposit.slowRelayFeePct === relay.slowRelayFeePct &&
        deposit.instantRelayFeePct === relay.instantRelayFeePct &&
        deposit.quoteTimestamp === relay.quoteTimestamp
    );
    if (matchedDeposits.length > 1) {
      this.logger.error({
        at: "InsuredBridgePriceFeed",
        message: "TODO: Handle multiple deposits associated with same relay attempt",
      });
      throw new Error("TODO: Handle multiple relays for same price request timestamp");
    } else if (matchedDeposits.length === 0) {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "No deposit event matching relay attempt",
      });
      return this.toBNWei(isRelayValid.No);
    }

    // Validate relays proposed realized fee percentage.
    const expectedRealizedFeePct = this.l1Client.calculateRealizedLpFeesPctForDeposit(/* matchedDeposits[0] */);
    if (expectedRealizedFeePct !== relay.realizedLpFeePct) {
      this.logger.error({
        at: "InsuredBridgePriceFeed",
        message: "Matched deposit with relay but realized fee % is incorrect",
      });
      return this.toBNWei(isRelayValid.No);
    }

    // TODO: Do we need to check other parameters like slow relayer address and deposit box contract address? These
    // are the other params included in the ancillary data by the BridgePool contract.

    // Passed all checks, relay is valid!
    return this.toBNWei(isRelayValid.Yes);
  }

  public getLastUpdateTime(): number | null {
    // TODO.
    return null;
  }

  public getLookback(): number | null {
    // TODO.
    return null;
  }

  public getCurrentPrice(): BN | null {
    // TODO. This doesn't seem appropriate for this pricefeed, perhaps it should always return null.
    return null;
  }

  public getPriceFeedDecimals(): number {
    // TODO.
    return this.decimals;
  }

  public async update(): Promise<void> {
    // Update clients
    await Promise.all([this.l1Client.update(), this.l2Client.update()]);

    // Store all deposit and relay data.
    this.deposits = this.l2Client.getAllDeposits();
    this.relays = this.l1Client.getAllRelayedDeposits();
    // TODO: This returns all relayed deposits including already disputed and settled ones. We should filter those out.
  }
}
