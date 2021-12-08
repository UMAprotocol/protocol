// A thick client for getting information about insured bridge L1 & L2 information. Simply acts to fetch information
// from the respective chains and return it to client implementors.

import { getAbi, BridgeDepositBoxWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import type { EventData } from "web3-eth-contract";
import { EventSearchOptions, getEventsForMultipleProviders } from "@uma/common";

const { toChecksumAddress } = Web3.utils;
import type { Logger } from "winston";

export interface Deposit {
  chainId: number;
  depositId: number;
  depositHash: string;
  l1Recipient: string;
  l2Sender: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  quoteTimestamp: number;
  depositContract: string;
}

export class InsuredBridgeL2Client {
  public bridgeDepositBox: BridgeDepositBoxWeb3;

  private deposits: { [key: string]: Deposit } = {}; // DepositHash=>Deposit
  private whitelistedTokens: { [key: string]: string } = {}; // L1Token=>L2Token

  private firstBlockToSearch: number;

  constructor(
    private readonly logger: Logger,
    readonly l2Web3: Web3,
    readonly bridgeDepositAddress: string,
    readonly chainId: number = 0,
    readonly startingBlockNumber: number = 0,
    readonly endingBlockNumber: number | null = null,
    readonly fallbackL2Web3s: Web3[] = []
  ) {
    this.bridgeDepositBox = (new l2Web3.eth.Contract(
      getAbi("BridgeDepositBox"),
      bridgeDepositAddress
    ) as unknown) as BridgeDepositBoxWeb3;

    this.firstBlockToSearch = startingBlockNumber;
  }

  getAllDeposits() {
    return Object.keys(this.deposits).map((depositHash: string) => this.deposits[depositHash]);
  }

  getAllDepositsForL1Token(l1TokenAddress: string) {
    return this.getAllDeposits().filter((deposit: Deposit) => deposit.l1Token === l1TokenAddress);
  }

  isWhitelistedToken(l1TokenAddress: string) {
    return this.whitelistedTokens[toChecksumAddress(l1TokenAddress)] !== undefined;
  }

  getDepositByHash(depositHash: string) {
    return this.deposits[depositHash];
  }

  // TODO: consider adding a method that limits how far back the deposits will be returned from. In this implementation
  // we might hit some performance issues when returning a lot of bridging actions

  async update(): Promise<void> {
    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: this.endingBlockNumber || (await this.l2Web3.eth.getBlockNumber()),
    };
    if (blockSearchConfig.fromBlock > blockSearchConfig.toBlock) {
      this.logger.debug({
        at: "InsuredBridgeL2Client",
        message: "All blocks are searched, returning early",
        toBlock: blockSearchConfig.toBlock,
      });
      return;
    }

    // TODO: update this state retrieval to include looking for L2 liquidity in the deposit box that can be sent over
    // the bridge. This should consider the minimumBridgingDelay and the lastBridgeTime for a respective L2Token.
    const [fundsDepositedEvents, whitelistedTokenEvents] = await Promise.all([
      this.getFundsDepositedEvents(blockSearchConfig),
      this.getWhitelistTokenEvents(blockSearchConfig),
    ]);

    // We assume that whitelisted token events are searched from oldest to newest so we'll just store the most recently
    // whitelisted token mappings.
    for (const whitelistedTokenEvent of whitelistedTokenEvents) {
      this.whitelistedTokens[toChecksumAddress(whitelistedTokenEvent.returnValues.l1Token)] = toChecksumAddress(
        whitelistedTokenEvent.returnValues.l2Token
      );
    }

    for (const fundsDepositedEvent of fundsDepositedEvents) {
      const depositData = {
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
      depositData.depositHash = this.generateDepositHash(depositData);
      this.deposits[depositData.depositHash] = depositData;
    }

    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({
      at: "InsuredBridgeL2Client",
      message: "Insured bridge l2 client updated",
      chainId: this.chainId,
    });
  }

  async getFundsDepositedEvents(eventSearchOptions: EventSearchOptions): Promise<EventData[]> {
    const eventsData = await getEventsForMultipleProviders(
      [this.l2Web3].concat(this.fallbackL2Web3s),
      getAbi("BridgeDepositBox"),
      this.bridgeDepositAddress,
      "FundsDeposited",
      eventSearchOptions
    );
    if (eventsData.missingEvents.length > 0) {
      const errorMessage = `L2 RPC endpoints disagree about L2 contract events, please manually investigate. L2 rpcs are described in NODE_URL and RETRY_CONFIG environment variables.`;
      const error = new Error(errorMessage);
      this.logger.error({
        at: "InsuredBridgeL2Client",
        message: "L2 RPC endpoint state disagreement! 🤺",
        eventName: "FundsDeposited",
        eventSearchOptions,
        countMissingEvents: eventsData.missingEvents.length,
        countMatchingEvents: eventsData.events.length,
        error,
      });
      throw error;
    }

    // All events were found in all providers, can return any of the event data arrays
    return eventsData.events;
  }

  async getWhitelistTokenEvents(eventSearchOptions: EventSearchOptions): Promise<EventData[]> {
    const eventsData = await getEventsForMultipleProviders(
      [this.l2Web3].concat(this.fallbackL2Web3s),
      getAbi("BridgeDepositBox"),
      this.bridgeDepositAddress,
      "WhitelistToken",
      eventSearchOptions
    );
    if (eventsData.missingEvents.length > 0) {
      const errorMessage = `L2 RPC endpoints disagree about L2 contract events, please manually investigate. L2 rpcs are described in NODE_URL and RETRY_CONFIG environment variables.`;
      const error = new Error(errorMessage);
      this.logger.error({
        at: "InsuredBridgeL2Client",
        message: "L2 RPC endpoint state disagreement! 🤺",
        eventName: "WhitelistToken",
        eventSearchOptions,
        countMissingEvents: eventsData.missingEvents.length,
        countMatchingEvents: eventsData.events.length,
        error,
      });
      throw error;
    }

    // All events were found in all providers, can return any of the event data arrays
    return eventsData.events;
  }

  generateDepositHash = (depositData: Deposit): string => {
    const depositDataAbiEncoded = this.l2Web3.eth.abi.encodeParameters(
      ["uint256", "uint64", "address", "address", "uint256", "uint64", "uint64", "uint32", "address"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
        depositData.l1Token,
      ]
    );
    const depositHash = this.l2Web3.utils.soliditySha3(depositDataAbiEncoded);
    if (depositHash == "" || depositHash == null) throw new Error("Bad deposit hash");
    return depositHash;
  };
}
