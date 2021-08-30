import type { Logger } from "winston";
import type { Abi, FinancialContractType } from "../types";
import type Web3 from "web3";
import type {
  ExpiringMultiPartyWeb3,
  ExpiringMultiPartyWeb3Events,
  PerpetualWeb3,
  PerpetualWeb3Events,
} from "@uma/contracts-node";

type LiquidationCreatedEvent = ExpiringMultiPartyWeb3Events.LiquidationCreated | PerpetualWeb3Events.LiquidationCreated;
type DisputeEvent = ExpiringMultiPartyWeb3Events.LiquidationDisputed | PerpetualWeb3Events.LiquidationDisputed;
type DisputeSettlementEvent = ExpiringMultiPartyWeb3Events.DisputeSettled | PerpetualWeb3Events.DisputeSettled;
type NewSponsorEvent = ExpiringMultiPartyWeb3Events.NewSponsor | PerpetualWeb3Events.NewSponsor;
type DepositEvent = ExpiringMultiPartyWeb3Events.Deposit | PerpetualWeb3Events.Deposit;
type CreateEvent = ExpiringMultiPartyWeb3Events.PositionCreated | PerpetualWeb3Events.PositionCreated;
type WithdrawEvent = ExpiringMultiPartyWeb3Events.Withdrawal | PerpetualWeb3Events.Withdrawal;
type RedeemEvent = ExpiringMultiPartyWeb3Events.Redeem | PerpetualWeb3Events.Redeem;
type RegularFeeEvent = ExpiringMultiPartyWeb3Events.RegularFeesPaid | PerpetualWeb3Events.RegularFeesPaid;
type FinalFeeEvent = ExpiringMultiPartyWeb3Events.FinalFeesPaid | PerpetualWeb3Events.FinalFeesPaid;
type LiquidationWithadrawnEvent =
  | ExpiringMultiPartyWeb3Events.LiquidationWithdrawn
  | PerpetualWeb3Events.LiquidationWithdrawn;
type SettleExpiredEvent = ExpiringMultiPartyWeb3Events.SettleExpiredPosition;
type SettleEmergencyShutdownEvent = PerpetualWeb3Events.SettleEmergencyShutdown;
type FundingRateUpdatedEvent = PerpetualWeb3Events.FundingRateUpdated;

interface TransactionMetadata {
  transactionHash: string;
  blockNumber: number;
}

// This defines a generic type that takes an event and returns the type that we export to the user to represent that
// event. It essentially combines the returnValues struct with a few fields that we add to all expoerts (hash and
// block number).
type EventExport<T extends { returnValues: any }> = T["returnValues"] & TransactionMetadata;

// A thick client for getting information about FinancialContract events. This client is kept separate from the
// FinancialContractClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

export class FinancialContractEventClient {
  public financialContract: ExpiringMultiPartyWeb3 | PerpetualWeb3;

  // Financial Contract Events data structure to enable synchronous retrieval of information.
  private liquidationEvents: EventExport<LiquidationCreatedEvent>[] = [];
  private disputeEvents: EventExport<DisputeEvent>[] = [];
  private disputeSettlementEvents: EventExport<DisputeSettlementEvent>[] = [];
  private newSponsorEvents: (EventExport<NewSponsorEvent> &
    Pick<EventExport<CreateEvent>, "tokenAmount" | "collateralAmount">)[] = [];
  private depositEvents: EventExport<DepositEvent>[] = [];
  private createEvents: EventExport<CreateEvent>[] = [];
  private withdrawEvents: EventExport<WithdrawEvent>[] = [];
  private redeemEvents: EventExport<RedeemEvent>[] = [];
  private regularFeeEvents: EventExport<RegularFeeEvent>[] = [];
  private finalFeeEvents: EventExport<FinalFeeEvent>[] = [];
  private liquidationWithdrawnEvents: (EventExport<LiquidationWithadrawnEvent> & { withdrawalAmount: string })[] = [];
  private settleExpiredPositionEvents: EventExport<SettleExpiredEvent | SettleEmergencyShutdownEvent>[] = [];
  private fundingRateUpdatedEvents: EventExport<FundingRateUpdatedEvent>[] = [];
  private firstBlockToSearch: number;
  private lastBlockToSearchUntil: number | null;
  private lastUpdateTimestamp: number;

  /**
   * @notice Constructs new FinancialContractEventClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractAbi Financial Contract truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} financialContractAddress Ethereum address of the Financial Contract contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    financialContractAbi: Abi,
    public readonly web3: Web3,
    financialContractAddress: string,
    startingBlockNumber = 0,
    endingBlockNumber: number | null = null,
    private contractType: FinancialContractType = "ExpiringMultiParty", // Default to Expiring Multi Party for now to enable backwards compatibility with other bots. This will be removed as soon as the other bots have been updated to work with these contract types.
    private contractVersion = "2.0.1"
  ) {
    // Financial Contract contract
    this.financialContract = (new this.web3.eth.Contract(
      financialContractAbi,
      financialContractAddress
    ) as unknown) as FinancialContractEventClient["financialContract"];

    // First block number to begin searching for events after.
    this.firstBlockToSearch = startingBlockNumber;

    // Last block number to end the searching for events at.
    this.lastBlockToSearchUntil = endingBlockNumber;
    this.lastUpdateTimestamp = 0;

    if (contractType !== "ExpiringMultiParty" && contractType !== "Perpetual")
      throw new Error(`Invalid type: ${contractType}! This client only supports ExpiringMultiParty or Perpetual`);
    if (contractVersion !== "2.0.1")
      throw new Error(`Invalid version: ${contractVersion}! This client only supports 2.0.1`);
  }
  // Delete all events within the client
  public async clearState(): Promise<void> {
    this.liquidationEvents = [];
    this.disputeEvents = [];
    this.disputeSettlementEvents = [];
    this.newSponsorEvents = [];
    this.depositEvents = [];
    this.createEvents = [];
    this.withdrawEvents = [];
    this.redeemEvents = [];
    this.regularFeeEvents = [];
    this.finalFeeEvents = [];
    this.liquidationWithdrawnEvents = [];
    this.settleExpiredPositionEvents = [];
    this.fundingRateUpdatedEvents = [];
  }

  public getAllNewSponsorEvents(): (EventExport<NewSponsorEvent> &
    Pick<EventExport<CreateEvent>, "tokenAmount" | "collateralAmount">)[] {
    return this.newSponsorEvents;
  }

  public getAllLiquidationEvents(): EventExport<LiquidationCreatedEvent>[] {
    return this.liquidationEvents;
  }

  public getAllDisputeEvents(): EventExport<DisputeEvent>[] {
    return this.disputeEvents;
  }

  public getAllDisputeSettlementEvents(): EventExport<DisputeSettlementEvent>[] {
    return this.disputeSettlementEvents;
  }

  public getAllDepositEvents(): EventExport<DepositEvent>[] {
    return this.depositEvents;
  }

  public getAllCreateEvents(): EventExport<CreateEvent>[] {
    return this.createEvents;
  }

  public getAllWithdrawEvents(): EventExport<WithdrawEvent>[] {
    return this.withdrawEvents;
  }

  public getAllRedeemEvents(): EventExport<RedeemEvent>[] {
    return this.redeemEvents;
  }

  public getAllRegularFeeEvents(): EventExport<RegularFeeEvent>[] {
    return this.regularFeeEvents;
  }

  public getAllFinalFeeEvents(): EventExport<FinalFeeEvent>[] {
    return this.finalFeeEvents;
  }

  public getAllLiquidationWithdrawnEvents(): (EventExport<LiquidationWithadrawnEvent> & {
    withdrawalAmount: string;
  })[] {
    return this.liquidationWithdrawnEvents;
  }

  public getAllSettleExpiredPositionEvents(): EventExport<
    ExpiringMultiPartyWeb3Events.SettleExpiredPosition | PerpetualWeb3Events.SettleEmergencyShutdown
  >[] {
    return this.settleExpiredPositionEvents;
  }

  public getAllFundingRateUpdatedEvents(): EventExport<PerpetualWeb3Events.FundingRateUpdated>[] {
    return this.fundingRateUpdatedEvents;
  }

  // Returns the last update timestamp.
  public getLastUpdateTime(): number {
    return this.lastUpdateTimestamp;
  }

  public async update(): Promise<void> {
    // The last block to search is either the value specified in the constructor (useful in serverless mode) or is the
    // latest block number (if running in loop mode).
    // Set the last block to search up until.
    const lastBlockToSearch = this.lastBlockToSearchUntil
      ? this.lastBlockToSearchUntil
      : await this.web3.eth.getBlockNumber();

    // Define a config to bound the queries by.
    const blockSearchConfig = { fromBlock: this.firstBlockToSearch, toBlock: lastBlockToSearch };

    // Look for events on chain from the previous seen block number to the current block number.
    const [
      currentTime,
      liquidationEventsObj,
      disputeEventsObj,
      disputeSettlementEventsObj,
      createEventsObj,
      newSponsorEventsObj,
      depositEventsObj,
      withdrawEventsObj,
      redeemEventsObj,
      regularFeeEventsObj,
      finalFeeEventsObj,
      liquidationWithdrawnEventsObj,
      settleExpiredPositionEventsObj,
    ] = (await Promise.all([
      this.financialContract.methods.getCurrentTime().call(),
      this.financialContract.getPastEvents("LiquidationCreated", blockSearchConfig),
      this.financialContract.getPastEvents("LiquidationDisputed", blockSearchConfig),
      this.financialContract.getPastEvents("DisputeSettled", blockSearchConfig),
      this.financialContract.getPastEvents("PositionCreated", blockSearchConfig),
      this.financialContract.getPastEvents("NewSponsor", blockSearchConfig),
      this.financialContract.getPastEvents("Deposit", blockSearchConfig),
      this.financialContract.getPastEvents("Withdrawal", blockSearchConfig),
      this.financialContract.getPastEvents("Redeem", blockSearchConfig),
      this.financialContract.getPastEvents("RegularFeesPaid", blockSearchConfig),
      this.financialContract.getPastEvents("FinalFeesPaid", blockSearchConfig),
      this.financialContract.getPastEvents("LiquidationWithdrawn", blockSearchConfig),
      this.contractType == "ExpiringMultiParty" // If the contract is an EMP then find the SettleExpiredPosition events.
        ? this.financialContract.getPastEvents("SettleExpiredPosition", blockSearchConfig)
        : this.financialContract.getPastEvents("SettleEmergencyShutdown", blockSearchConfig), // Else, find the SettleEmergencyShutdown events.
    ] as any[])) as [
      string,
      LiquidationCreatedEvent[],
      DisputeEvent[],
      DisputeSettlementEvent[],
      CreateEvent[],
      NewSponsorEvent[],
      DepositEvent[],
      WithdrawEvent[],
      RedeemEvent[],
      RegularFeeEvent[],
      FinalFeeEvent[],
      LiquidationWithadrawnEvent[],
      SettleExpiredEvent[] | SettleEmergencyShutdownEvent[]
    ];
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = parseInt(currentTime);

    // Process the responses into clean objects.
    // Liquidation events.
    for (const event of liquidationEventsObj) {
      this.liquidationEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Dispute events.
    for (const event of disputeEventsObj) {
      this.disputeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Dispute settlement events.
    for (const event of disputeSettlementEventsObj) {
      this.disputeSettlementEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Create events.
    for (const event of createEventsObj) {
      this.createEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // NewSponsor events mapped against PositionCreated events to determine size of new positions created.
    for (const event of newSponsorEventsObj) {
      // Every transaction that emits a NewSponsor event must also emit a PositionCreated event.
      // We assume that there is only one PositionCreated event that has the same block number as
      // the current NewSponsor event.
      const createEvent = this.createEvents.filter((e) => e.blockNumber === event.blockNumber);

      this.newSponsorEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
        collateralAmount: createEvent[0].collateralAmount,
        tokenAmount: createEvent[0].tokenAmount,
      });
    }

    // Deposit events.
    for (const event of depositEventsObj) {
      this.depositEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Withdraw events.
    for (const event of withdrawEventsObj) {
      this.withdrawEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Redeem events.
    for (const event of redeemEventsObj) {
      this.redeemEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Regular fee events.
    for (const event of regularFeeEventsObj) {
      this.regularFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Final fee events.
    for (const event of finalFeeEventsObj) {
      this.finalFeeEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Liquidation withdrawn events.
    for (const event of liquidationWithdrawnEventsObj) {
      this.liquidationWithdrawnEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
        withdrawalAmount: event.returnValues.paidToLiquidator,
      });
    }

    // Settle expired position events.
    for (const event of settleExpiredPositionEventsObj) {
      this.settleExpiredPositionEvents.push({
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...event.returnValues,
      });
    }

    // Look for perpetual specific events:
    if (this.contractType == "Perpetual") {
      const [fundingRateUpdatedEventsObj] = ((await Promise.all([
        this.financialContract.getPastEvents("FundingRateUpdated", blockSearchConfig),
      ])) as unknown) as [FundingRateUpdatedEvent[]];

      // Funding Rate Updated events
      for (const event of fundingRateUpdatedEventsObj) {
        this.fundingRateUpdatedEvents.push({
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          ...event.returnValues,
        });
      }
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "FinancialContractEventClient",
      message: "Financial Contract event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}
