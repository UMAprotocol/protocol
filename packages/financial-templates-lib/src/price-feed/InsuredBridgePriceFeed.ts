import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { parseAncillaryData } from "@uma/common";
import { BN } from "../types";
import type { Logger } from "winston";
import { InsuredBridgeL1Client } from "../clients/InsuredBridgeL1Client";
import { InsuredBridgeL2Client, Deposit } from "../clients/InsuredBridgeL2Client";

const { toBN, toWei, toChecksumAddress } = Web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

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

interface RelayAncillaryData {
  chainId: number;
  depositId: number;
  recipient: string;
  l2Sender: string;
  l1Token: string;
  amount: number;
  slowRelayFeePct: number;
  instantRelayFeePct: number;
  quoteTimestamp: number;
  realizedLpFeePct: number;
  depositContract: string;
  priceRequestTime: string;
}

// Allows user to respond to a "relay" price request that was sent in response to a "deposit" on a InsuredBridge
// deployed to an L2 network. The relay price request is submitted on L1. This pricefeed will respond "Yes" or "No"
// based on whether the relay was correctly constructed to match a deposit. The price request includes parameters in
// its ancillary data that must be parsed from the hex ancillary data.
export class InsuredBridgePriceFeed extends PriceFeedInterface {
  private readonly decimals: number;
  private readonly logger: Logger;
  private readonly l1Client: InsuredBridgeL1Client;
  private readonly l2Client: InsuredBridgeL2Client;
  private deposits: Deposit[] = [];

  /**
   * @notice Constructs the InsuredBridgePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} l1Client Fetches and returns latest state of L1 pool and admin contracts.
   * @param {Object} l2Client Fetches and returns latest state of L2 deposit contract.
   */
  constructor({ logger, l1Client, l2Client }: Params) {
    super();

    this.decimals = 18;
    this.logger = logger;
    this.l1Client = l1Client;
    this.l2Client = l2Client;
  }

  // This method returns the validity of a relay price request attempt. The relay request was valid if and only if it:
  // The price request's ancillary data contains parameters that match with an L2 deposit event.
  public async getHistoricalPrice(time: number | string, ancillaryData: string): Promise<BN> {
    // Note: `time` is unused in this method because it is not included in the relay ancillary data.

    // Parse ancillary data for relay request and find deposit if possible with matching params.
    const parsedAncillaryData: RelayAncillaryData = (parseAncillaryData(
      ancillaryData
    ) as unknown) as RelayAncillaryData;
    const matchedDeposit = this.deposits.filter(
      (deposit: Deposit) =>
        deposit.chainId === parsedAncillaryData.chainId &&
        deposit.depositId === parsedAncillaryData.depositId &&
        deposit.recipient === toChecksumAddress("0x" + parsedAncillaryData.recipient) &&
        deposit.sender === toChecksumAddress("0x" + parsedAncillaryData.l2Sender) &&
        deposit.l1Token === toChecksumAddress("0x" + parsedAncillaryData.l1Token) &&
        deposit.amount === parsedAncillaryData.amount.toString() &&
        deposit.slowRelayFeePct === parsedAncillaryData.slowRelayFeePct.toString() &&
        deposit.instantRelayFeePct === parsedAncillaryData.instantRelayFeePct.toString() &&
        deposit.quoteTimestamp === parsedAncillaryData.quoteTimestamp &&
        this.l2Client.bridgeDepositAddress === toChecksumAddress("0x" + parsedAncillaryData.depositContract)
    );

    // TODO: Do we need to handle the case where all of these params are matched and matchedDeposit.length > 1?
    if (matchedDeposit.length === 0) {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "No deposit event found matching relay request ancillary data and time",
        parsedAncillaryData,
      });
      return toBNWei(isRelayValid.No);
    }

    // Validate relays proposed realized fee percentage.
    const expectedRealizedFeePct = this.l1Client.calculateRealizedLpFeesPctForDeposit(/* matchedDeposit[0] */);
    if (expectedRealizedFeePct !== parsedAncillaryData.realizedLpFeePct.toString()) {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "Matched deposit realized fee % is incorrect",
      });
      return toBNWei(isRelayValid.No);
    }

    // Passed all checks, relay is valid!
    return toBNWei(isRelayValid.Yes);
  }

  public getLastUpdateTime(): number | null {
    // TODO.
    return null;
  }

  public getLookback(): number | null {
    // TODO. We could use the L1/L2 client's starting block number and network average block propagation time to
    // determine this value.
    return null;
  }

  public getCurrentPrice(): BN | null {
    // TODO. This doesn't seem appropriate for this pricefeed, perhaps it should always return null. Or, it could
    // re-use the `getHistoricalPrice` logic and for the current timestamp.
    return null;
  }

  public getPriceFeedDecimals(): number {
    return this.decimals;
  }

  public async update(): Promise<void> {
    // Update clients
    await Promise.all([this.l1Client.update(), this.l2Client.update()]);

    // Store all deposit and relay data.
    this.deposits = this.l2Client.getAllDeposits();
  }
}
