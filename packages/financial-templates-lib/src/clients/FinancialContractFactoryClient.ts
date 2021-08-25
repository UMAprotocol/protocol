// A thick client for getting information about FinancialContractFactory contracts.
import _ from "lodash";
import type { Logger } from "winston";
import type { Abi, FinancialContractFactoryType } from "../types";
import type Web3 from "web3";
import type {
  ExpiringMultiPartyCreatorWeb3,
  ExpiringMultiPartyCreatorWeb3Events,
  PerpetualCreatorWeb3,
  PerpetualCreatorWeb3Events,
} from "@uma/contracts-node";

type FinancialContractFactory = ExpiringMultiPartyCreatorWeb3 | PerpetualCreatorWeb3;

interface ContractCreationEvent {
  transactionHash: string;
  blockNumber: number;
  deployerAddress: string;
  contractAddress: string;
}

export class FinancialContractFactoryClient {
  public readonly financialContractFactory: FinancialContractFactory;
  // Factory Contract Events data structure to enable synchronous retrieval of information.
  private createdContractEvents: ContractCreationEvent[] = [];

  // First block number to begin searching for events after.
  private firstBlockToSearch: number;

  // Last block number to end the searching for events at.
  private lastBlockToSearchUntil: number | null;
  private lastUpdateTimestamp: number;

  /**
   * @notice Constructs new FinancialContractFactoryClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractFactoryAbi ExpiringMultiPartyCreator or PerpetualMultiPartyCreator truffle ABI object.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} financialContractFactoryAddress Ethereum address of the factory contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    financialContractFactoryAbi: Abi,
    public readonly web3: Web3,
    financialContractFactoryAddress: string,
    startingBlockNumber = 0,
    endingBlockNumber: number | null = null,
    private readonly contractType: FinancialContractFactoryType = "PerpetualCreator" // Default to PerpetualMultiParty for now since the first intended user is the funding rate proposer bot.
  ) {
    // Factory contract
    this.financialContractFactory = (new this.web3.eth.Contract(
      financialContractFactoryAbi,
      financialContractFactoryAddress
    ) as unknown) as FinancialContractFactory;

    this.firstBlockToSearch = startingBlockNumber;
    this.lastBlockToSearchUntil = endingBlockNumber;
    this.lastUpdateTimestamp = 0;

    if (contractType !== "ExpiringMultiPartyCreator" && contractType !== "PerpetualCreator")
      throw new Error(
        `Invalid contract type provided: ${contractType}! The financial product factory client only supports ExpiringMultiPartyCreator or PerpetualCreator`
      );
  }
  // Delete all events within the client
  async clearState(): Promise<void> {
    this.createdContractEvents = [];
  }

  getContractType(): FinancialContractFactoryType {
    return this.contractType;
  }

  getAllCreatedContractEvents(): ContractCreationEvent[] {
    return this.createdContractEvents;
  }

  getAllCreatedContractAddresses(): string[] {
    return _.uniq(this.createdContractEvents.map((event) => event.contractAddress));
  }

  // Returns the last update timestamp.
  getLastUpdateTime(): number {
    return this.lastUpdateTimestamp;
  }

  async update(): Promise<void> {
    // The last block to search is either the value specified in the constructor (useful in serverless mode) or is the
    // latest block number (if running in loop mode).
    // Set the last block to search up until.
    const lastBlockToSearch = this.lastBlockToSearchUntil
      ? this.lastBlockToSearchUntil
      : await this.web3.eth.getBlockNumber();

    // Define a config to bound the queries by.
    const blockSearchConfig = { fromBlock: this.firstBlockToSearch, toBlock: lastBlockToSearch };

    // Look for events on chain from the previous seen block number to the current block number.
    const eventToSearchFor =
      this.contractType === "PerpetualCreator" ? "CreatedPerpetual" : "CreatedExpiringMultiParty";
    const [currentTime, createdContractEventsObj] = await Promise.all([
      this.financialContractFactory.methods.getCurrentTime().call(),
      this.financialContractFactory.getPastEvents(eventToSearchFor, blockSearchConfig),
    ]);

    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = parseInt(currentTime);

    // Process the responses into clean objects.
    if (this.contractType === "ExpiringMultiPartyCreator") {
      for (const event of (createdContractEventsObj as unknown) as ExpiringMultiPartyCreatorWeb3Events.CreatedExpiringMultiParty[]) {
        this.createdContractEvents.push({
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          deployerAddress: event.returnValues.deployerAddress,
          contractAddress: event.returnValues.expiringMultiPartyAddress,
        });
      }
    } else if (this.contractType === "PerpetualCreator") {
      for (const event of (createdContractEventsObj as unknown) as PerpetualCreatorWeb3Events.CreatedPerpetual[]) {
        this.createdContractEvents.push({
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          deployerAddress: event.returnValues.deployerAddress,
          contractAddress: event.returnValues.perpetualAddress,
        });
      }
    } else {
      throw new Error(`Unexpected type ${this.contractType}`);
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "FinancialContractFactoryClient",
      message: "Financial Contract Factory event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}
