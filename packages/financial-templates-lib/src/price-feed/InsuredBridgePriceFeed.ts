import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { getAbi } from "@uma/contracts-node";
import { getEventsWithPaginatedBlockSearch, parseAncillaryData, Web3Contract } from "@uma/common";
import { BN } from "../types";
import type { Logger } from "winston";
import { InsuredBridgeL1Client, Relay } from "../clients/InsuredBridgeL1Client";
import { InsuredBridgeL2Client, Deposit } from "../clients/InsuredBridgeL2Client";

const { toBN, toWei } = Web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

enum isRelayValid {
  No, // Should be 0
  Yes, // Should be 1
}

interface Params {
  logger: Logger;
  l1Client: InsuredBridgeL1Client;
  l2Client: InsuredBridgeL2Client;
}

interface RelayAncillaryData {
  relayHash: string;
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
    const parsedAncillaryData = (parseAncillaryData(ancillaryData) as unknown) as RelayAncillaryData;
    const relayAncillaryDataHash = "0x" + parsedAncillaryData.relayHash;

    // Search through all DepositRelayed events across all BridgePools to find specific relay.
    // We can't simply use l1Client.getAllRelayedDeposits because this method overwrites any relays that are disputed
    // with follow up relays, and usually we'll need to validate such an overwritten relay that has gone to dispute.
    interface MatchedRelay {
      relayData: Relay;
      depositData: Deposit;
      depositHash: string;
    }
    let matchedRelay: MatchedRelay | undefined;
    const latestL1Block = await this.l1Client.l1Web3.eth.getBlockNumber()
    for (const bridgePoolAddress of this.l1Client.getBridgePoolsAddresses()) {
      const bridgePool = new this.l1Client.l1Web3.eth.Contract(getAbi("BridgePool"), bridgePoolAddress);
      const relays = await getEventsWithPaginatedBlockSearch(bridgePool, "DepositRelayed", 0, latestL1Block, 20000);
      const relay = relays.eventData.find(
        (_relay) => _relay.returnValues.relayAncillaryDataHash === relayAncillaryDataHash
      );
      if (relay) {
        matchedRelay = {
          relayData: {
            ...relay.returnValues.relay,
            blockNumber: relay.blockNumber,
          },
          depositData: {
            ...relay.returnValues.depositData,
            // quoteTimestamp type needs to be number for calculateRealizedLpFeePctForDeposit() to work.
            quoteTimestamp: Number(relay.returnValues.depositData.quoteTimestamp),
            l1Token: await bridgePool.methods.l1Token().call(),
          },
          depositHash: relay.returnValues.depositHash,
        };
        break;
      }
    }
    if (!matchedRelay) {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "No relay event found matching provided ancillary data. Has the relay been finalized already?",
      });
      return toBNWei(isRelayValid.No);
    } else {
      this.logger.debug({
        at: "InsuredBridgePriceFeed",
        message: "Matched relay",
        matchedRelay,
      });
      // We found a relay on-chain, whether its pending, finalized, or disputed. Now let's find the matching deposit.
      // Note this will always fail to find a matching deposit if the L2 web3 node is set incorrectly.
      const deposit = this.deposits.find((deposit) => {
        return deposit.depositHash === matchedRelay?.depositHash;
      });
      if (!deposit) {
        this.logger.debug({
          at: "InsuredBridgePriceFeed",
          message:
            "No deposit event found matching relay request ancillary data and time. Are you using the correct L2 network?",
          matchedRelay,
        });
        return toBNWei(isRelayValid.No);
      } else {
        this.logger.debug({
          at: "InsuredBridgePriceFeed",
          message: "Matched deposit",
          deposit,
        });
      }

      // If deposit.quoteTimestamp > relay.blockTime then its an invalid relay because it would have
      // been impossible for the relayer to compute the realized LP fee % for the deposit.quoteTime in the future.
      const relayBlockTime = Number(
        (await this.l1Client.l1Web3.eth.getBlock(matchedRelay.relayData.blockNumber)).timestamp
      );
      if (deposit.quoteTimestamp > relayBlockTime) {
        this.logger.debug({
          at: "InsuredBridgePriceFeed",
          message: "Deposit quote time > relay block time",
          deposit,
          matchedRelay,
          relayBlockTime,
        });
        return toBNWei(isRelayValid.No);
      }

      // Validate relays proposed realized fee percentage.
      const expectedRealizedFeePct = await this.l1Client.calculateRealizedLpFeePctForDeposit(matchedRelay.depositData);

      // Note: The `calculateRealizedLpFeePctForDeposit` will fail if the deposit.quote time is either less than the bridge
      // pool's deployment time, or greater than the latest block time.
      if (expectedRealizedFeePct.toString() !== matchedRelay.relayData.realizedLpFeePct) {
        this.logger.debug({
          at: "InsuredBridgePriceFeed",
          message: "Matched deposit realized fee % is incorrect",
          matchedRelay,
          expectedRealizedFeePct: expectedRealizedFeePct.toString(),
        });
        return toBNWei(isRelayValid.No);
      } else {
        this.logger.debug({
          at: "InsuredBridgePriceFeed",
          message: "Expected realized fee % matches fee set in relay!",
          expectedRealizedFeePct: expectedRealizedFeePct.toString(),
        });
      }
    }

    // Passed all checks, relay is valid!
    this.logger.debug({
      at: "InsuredBridgePriceFeed",
      message: "Relay validation passed all tests",
    });
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
