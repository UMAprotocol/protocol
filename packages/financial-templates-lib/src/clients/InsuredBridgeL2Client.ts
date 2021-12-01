// A thick client for getting information about insured bridge L1 & L2 information. Simply acts to fetch information
// from the respective chains and return it to client implementors.

import { getAbi } from "@uma/contracts-node";
import type { BridgeDepositBoxWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import { EventData } from "web3-eth-contract";
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

type EventSearchOptions = {
  fromBlock: number;
  toBlock: number;
  filter?: any; // Object, allows caller to filter events by indexed paramateres. e.g. {filter: {myNumber: [12,13]}}
  // filters all events where "myNumber" is 12 or 13.
};

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
    const eventsData = await this.getEventsForMultipleProviders(
      [this.l2Web3].concat(this.fallbackL2Web3s),
      this.bridgeDepositBox.options.jsonInterface,
      this.bridgeDepositAddress,
      "FundsDeposited",
      eventSearchOptions
    );
    // TODO: Should we throw, or even send a warning?
    if (eventsData.missingEvents.length > 0) {
      // TODO: Do something with eventsData.missingEvents array?
      throw new Error(
        `${eventsData.missingEvents.length} FundsDeposited events found in fallback l2 provider not found in all l2 web3 providers`
      );
    }

    // All events were found in all providers, can return any of the event data arrays
    return eventsData.events;
  }

  async getWhitelistTokenEvents(eventSearchOptions: EventSearchOptions): Promise<EventData[]> {
    const eventsData = await this.getEventsForMultipleProviders(
      [this.l2Web3].concat(this.fallbackL2Web3s),
      this.bridgeDepositBox.options.jsonInterface,
      this.bridgeDepositAddress,
      "WhitelistToken",
      eventSearchOptions
    );
    // TODO: Should we throw, or even send a warning?
    if (eventsData.missingEvents.length > 0) {
      // TODO: Do something with eventsData.missingEvents array?
      throw new Error(
        `${eventsData.missingEvents.length} WhitelistToken events found in fallback l2 provider not found in all l2 web3 providers`
      );
    }

    // All events were found in all providers, can return any of the event data arrays
    return eventsData.events;
  }

  /**
   * Fetches specified contract event data for all input web3 providers. Returns false if any of the events found with
   * one provider are NOT matched exactly in ALL of the other providers' event arrays.
   * @param web3s Web3 providers to check for target event.
   * @param contractAbi Contract ABI to query target event on.
   * @param contractAddress Contract address to query target event on.
   * @param eventName Name of target event.
   * @param eventSearchOptions Target event search options. See here for more details: https://web3js.readthedocs.io/en/v1.5.2/web3-eth-contract.html#getpastevents
   * @returns Object containing success of event query, missing events not found in all providers, and all event data
   */
  async getEventsForMultipleProviders(
    web3s: Web3[],
    contractAbi: any[],
    contractAddress: string,
    eventName: string,
    eventSearchOptions: EventSearchOptions
  ): Promise<{ missingEvents: EventData[]; events: EventData[] }> {
    const allProviderEvents = await Promise.all(
      web3s.map((_web3) => {
        const _contract = new _web3.eth.Contract(contractAbi, contractAddress);
        return _contract.getPastEvents(eventName, eventSearchOptions);
      })
    );

    // Associate each event with a key uniquely identifying the event. We'll use this key in the next step to determine
    // which events were returned by all providers.
    type UniqueEventData = { [uniqueEventKey: string]: EventData };
    const uniqueEventsForProvider: UniqueEventData[] = [];
    // [index of web3Provider => {eventKey => event}]

    const _getUniqueEventKey = (event: EventData): string => {
      return JSON.stringify({
        transactionHash: event.transactionHash,
        transactionIndex: event.transactionIndex,
        logIndex: event.logIndex,
        returnValues: event.returnValues,
        address: event.address,
      });
    };
    allProviderEvents.forEach((eventDataForProvider, i) => {
      uniqueEventsForProvider[i] = {};
      eventDataForProvider.forEach((event) => {
        const uniqueEventKey = _getUniqueEventKey(event);
        uniqueEventsForProvider[i][uniqueEventKey] = event;
      });
    });

    // Store only the events returned by ALL providers.
    const eventKeysReturnedByAllProviders: string[] = [];
    const missingEventKeys: string[] = [];
    Object.keys(uniqueEventsForProvider[0]).forEach((eventKeysForFirstProvider: string) => {
      let eventFoundInAllProviders = true;
      for (let providerIndex = 1; providerIndex < uniqueEventsForProvider.length; providerIndex++) {
        if (uniqueEventsForProvider[providerIndex][eventKeysForFirstProvider] === undefined) {
          eventFoundInAllProviders = false;
          break;
        }
      }
      if (eventFoundInAllProviders) eventKeysReturnedByAllProviders.push(eventKeysForFirstProvider);
      else missingEventKeys.push(eventKeysForFirstProvider);
    });

    return {
      missingEvents: missingEventKeys.map((eventKey) => uniqueEventsForProvider[0][eventKey]),
      events: eventKeysReturnedByAllProviders.map((eventKey) => uniqueEventsForProvider[0][eventKey]),
    };
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
