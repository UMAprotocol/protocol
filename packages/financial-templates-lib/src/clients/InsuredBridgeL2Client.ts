// A thick client for getting information about insured bridge L1 & L2 information. Simply acts to fetch information
// from the respective chains and return it to client implementors.

import { getAbi } from "@uma/contracts-node";
import type { BridgeDepositBoxWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import { EventData, Contract } from "web3-eth-contract";
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

type BlockSearchConfig = {
  fromBlock: number;
  toBlock: number;
};

export class InsuredBridgeL2Client {
  public bridgeDepositBox: BridgeDepositBoxWeb3;
  private bridgeDepositBoxContract: Contract;

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
    this.bridgeDepositBoxContract = new l2Web3.eth.Contract(getAbi("BridgeDepositBox"), bridgeDepositAddress);
    this.bridgeDepositBox = (this.bridgeDepositBoxContract as unknown) as BridgeDepositBoxWeb3;

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

  async getFundsDepositedEvents(blockSearchConfig: BlockSearchConfig): Promise<EventData[]> {
    const eventsData = await this.getEventsForMultipleProviders(
      this.fallbackL2Web3s,
      this.bridgeDepositBoxContract,
      "FundsDeposited",
      blockSearchConfig
    );
    if (!eventsData.success)
      throw new Error(
        `FundsDeposited transaction hash ${eventsData.missingEvent} found in fallback l2 provider not found in first l2 web3 provider`
      );
    return eventsData.events[0];
  }

  async getWhitelistTokenEvents(blockSearchConfig: BlockSearchConfig): Promise<EventData[]> {
    const eventsData = await this.getEventsForMultipleProviders(
      this.fallbackL2Web3s,
      this.bridgeDepositBoxContract,
      "WhitelistToken",
      blockSearchConfig
    );
    if (!eventsData.success)
      throw new Error(
        `WhitelistToken transaction hash ${eventsData.missingEvent} found in fallback l2 provider not found in first l2 web3 provider`
      );
    return eventsData.events[0];
  }

  /**
   * Fetches specified event data for all input web3 providers. Assumes that the first fetched EventData array contains
   * the "control" events. Compares the "control" events against each of the other EventData arrays. Returns false
   * if any of the "control" events are NOT found exactly in ALL of the other EventData arrays.
   * @param web3s Web3 providers to check for target event.
   * @param contract Contract to query target event on.
   * @param eventName Name of target event
   * @param blockSearchConfig Target event search config
   * @returns Object containing success of event query, missing event if not found in all providers, and all event data
   */
  async getEventsForMultipleProviders(
    web3s: Web3[],
    contract: Contract,
    eventName: string,
    blockSearchConfig: BlockSearchConfig
  ): Promise<{ success: boolean; missingEvent: string | null; events: EventData[][] }> {
    const getEventsPromises = [contract.getPastEvents(eventName, blockSearchConfig)];

    // For each fallback web3 provider, check that the specified events are also found by those providers,
    // otherwise throw an error. This allows the caller to have additional confidence about the accuracy of fetched
    // contract state.
    for (let i = 0; i < web3s.length; i++) {
      const _contract = new web3s[i].eth.Contract(contract.options.jsonInterface, contract.options.address);
      getEventsPromises.push(_contract.getPastEvents(eventName, blockSearchConfig));
    }
    const events = await Promise.all(getEventsPromises);

    const controlEvents = events[0].map((event) => event.transactionHash);

    // events[0] contains the events returned by the main web3 provider at index 0. We'll compare those events
    // against those returned by the fallback providers in events[1,...n].
    for (let i = 1; i < events.length; i++) {
      const fallbackEvents = events[i];
      fallbackEvents.forEach((event) => {
        if (!controlEvents.includes(event.transactionHash)) {
          return {
            success: false,
            missingEvent: event.transactionHash,
            events,
          };
        }
      });
    }

    // All events[0] found in each of the other events[1,...n] arrays!
    return {
      success: true,
      missingEvent: null,
      events,
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
