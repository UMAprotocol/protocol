import assert from "assert";
import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { parseAncillaryData } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { BN } from "../types";
import type { Logger } from "winston";
import { InsuredBridgeL1Client } from "../clients/InsuredBridgeL1Client";
import { InsuredBridgeL2Client } from "../clients/InsuredBridgeL2Client";

const { toBN, isAddress } = Web3.utils;

enum relayState {
  Pending,
  SpedUp,
  Disputed,
  Finalized,
}

enum isRelayValid {
  Yes,
  No,
}

interface Params {
  logger: Logger;
  web3: Web3;
  bridgeAdminAddress: string;
}

interface Relay {
  bridgePoolAddress: string;
  quoteTimestamp: number;
  depositId: number;
  sender: string;
  slowRelayer: string;
  disputedSlowRelayers: string[];
  instantRelayer: string;
  depositTimestamp: number;
  recipient: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  realizedLpFeePct: string;
  priceRequestAncillaryDataHash: string;
  depositHash: string;
  depositContract: string;
  relayState: relayState;
  relayTimestamp: number;
}

interface Deposit {
  depositId: number;
  timestamp: number;
  sender: string;
  recipient: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  quoteTimestamp: number;
}

// Allows user to respond to a "relay" price request that was sent in response to a "deposit" on a InsuredBridge
// deployed to an L2 network. The relay price request is submitted on L1. This pricefeed will respond True or False
// based on whether the relay was correctly constructed to match a deposit. The price request includes parameters in
// its ancillary data that must be parsed from the hex ancillary data.
export class InsuredBridgePriceFeed extends PriceFeedInterface {
  private readonly decimals: number;
  private readonly logger: Logger;
  private readonly web3: Web3;
  private readonly bridgeAdminAddress: string;
  private l1Client: InsuredBridgeL1Client | null = null;
  private l2Client: InsuredBridgeL2Client | null = null;
  private relays: Relay[] = [];
  private deposits: Deposit[] = [];

  /**
   * @notice Constructs the InsuredBridgePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider to connect to Ethereum network.
   * @param {String} bridgeAdminAddress Address of BridgeAdmin contract on L1.
   * @param
   */
  constructor({ logger, web3, bridgeAdminAddress }: Params) {
    super();

    assert(isAddress(bridgeAdminAddress), "bridgeAdminAddress required");

    this.decimals = 18;
    this.logger = logger;
    this.web3 = web3;
    this.bridgeAdminAddress = bridgeAdminAddress;
  }

  public async getHistoricalPrice(time: number | string): Promise<BN> {
    // Grab price request for a timestamp and parse the ancillary data for the request.
    const matchedRelays = this.relays.filter((relay: Relay) => relay.relayTimestamp === time);
    if (matchedRelays.length > 1) throw new Error("TODO: Handle multiple relays for same price request timestamp");
    if (matchedRelays.length === 0) throw new Error("No price request for time");
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
    // Create L1/L2 clients to pull data to inforrelayer.
    // TODO: incorporate start and end block numbers.
    this.l1Client = new InsuredBridgeL1Client(
      this.logger,
      getAbi("BridgeAdmin"),
      getAbi("BridgePool"),
      this.web3,
      this.bridgeAdminAddress
    );

    // Fetch the deposit contract address from the bridge admin.
    const bridgeDepositBoxAddress = await new this.web3.eth.Contract(
      getAbi("BridgeAdmin"),
      this.bridgeAdminAddress
    ).methods
      .depositContract()
      .call();

    this.l2Client = new InsuredBridgeL2Client(
      this.logger,
      getAbi("OVM_BridgeDepositBox"),
      this.web3, // TODO: Change to L2 web3 provider
      bridgeDepositBoxAddress
    );

    // Update clients
    await Promise.all([this.l1Client.update(), this.l2Client.update()]);

    // Store all deposit and relay data.
    this.deposits = this.l2Client.getAllDeposits();
    this.relays = this.l1Client.getAllRelayedDeposits();
  }
}
