import assert from "assert";
import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { parseAncillaryData } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { BN } from "../types";
import type { Logger } from "winston";
import { InsuredBridgeL1Client, Relay } from "../clients/InsuredBridgeL1Client";
import { InsuredBridgeL2Client, Deposit } from "../clients/InsuredBridgeL2Client";

const { toBN } = Web3.utils;

enum isRelayValid {
  Yes,
  No,
}

interface Params {
  logger: Logger;
  web3: Web3;
  l1Client: InsuredBridgeL1Client;
  l2Client: InsuredBridgeL2Client;
}

// Allows user to respond to a "relay" price request that was sent in response to a "deposit" on a InsuredBridge
// deployed to an L2 network. The relay price request is submitted on L1. This pricefeed will respond True or False
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
  }

  public async getHistoricalPrice(time: number | string): Promise<BN> {
    // Grab price request for a timestamp and parse the ancillary data for the request.
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
      return toBN(isRelayValid.No);
    }

    const relay = matchedRelays[0];

    // TODO: Not 100% sure we should reconstruct the relay ancillary data using deposit/relay data from the L2/L1
    // clients but if we do so, then this would act as a secondary check against the client data.
    // TODO: Reconstruct relay ancillary data. Is there a better way to do this using only the data in `relay`, where
    // we don't have to call the `bridgePool` contract?
    const depositData = {
      depositId: relay.depositId,
      depositTimestamp: relay.depositTimestamp,
      recipient: relay.recipient,
      l2Sender: relay.sender,
      l1Token: relay.l1Token,
      amount: relay.amount,
      slowRelayFeePct: relay.slowRelayFeePct,
      instantRelayFeePct: relay.instantRelayFeePct,
      quoteTimestamp: relay.quoteTimestamp,
    };
    const relayData = {
      relayState: relay.relayState,
      priceRequestTime: relay.relayTimestamp,
      realizedLpFeePct: relay.realizedLpFeePct,
      slowRelayer: relay.slowRelayer,
      instantRelayer: relay.instantRelayer,
    };
    const bridgePool = new this.web3.eth.Contract(getAbi("BridgePool"), relay.bridgePoolAddress);
    const relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
    const parsedAncillaryData = parseAncillaryData(relayAncillaryData);

    // Placeholder validation that the ancillary data correctly corresponds to this relay event
    assert(Object.keys(parsedAncillaryData).length > 0);

    console.log(relay);
    console.log(parseAncillaryData(relayAncillaryData));

    // TODO: Using ancillary data for relay, validate that it matches with deposit.
    return toBN(isRelayValid.Yes);
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
    // TODO. This should probably return the same thing as `getHistoricalPrice`? Not sure if there is a different
    // between historical and current prices for this pricefeed.
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
  }
}
