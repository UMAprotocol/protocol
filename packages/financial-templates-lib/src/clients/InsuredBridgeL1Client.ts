import Web3 from "web3";
const { toBN, soliditySha3, toChecksumAddress } = Web3.utils;

import { BlockFinder } from "../price-feed/utils";
import { getAbi } from "@uma/contracts-node";
import { Deposit } from "./InsuredBridgeL2Client";
import { across } from "@uma/sdk";

import type { BridgeAdminInterfaceWeb3, BridgePoolWeb3, RateModelStoreWeb3 } from "@uma/contracts-node";
import type { Logger } from "winston";
import type { BN } from "@uma/common";
import type { BlockTransactionBase } from "web3-eth";

export enum ClientRelayState {
  Uninitialized, // Deposit on L2, nothing yet on L1. Can be slow relayed and can be sped up to instantly relay.
  Pending, // Deposit on L2 and has been slow relayed on L1. Can be sped up to instantly relay.
  Finalized, // Relay has been finalized through slow relay passed liveness or instantly relayed. Cant do anything.
}

export enum SettleableRelay {
  CannotSettle,
  SlowRelayerCanSettle,
  AnyoneCanSettle,
}

export interface Relay {
  relayId: number;
  chainId: number;
  depositId: number;
  l2Sender: string;
  slowRelayer: string;
  l1Recipient: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  quoteTimestamp: number;
  realizedLpFeePct: string;
  priceRequestTime: number;
  depositHash: string;
  relayState: ClientRelayState;
  relayAncillaryDataHash: string;
  proposerBond: string;
  finalFee: string;
  settleable: SettleableRelay;
  blockNumber: number;
}

export interface InstantRelay {
  instantRelayer: string;
}

export interface BridgePoolData {
  contract: BridgePoolWeb3;
  earliestValidDepositQuoteTime: number;
  l2Token: { [chainId: string]: string }; // chainID=>L2TokenAddress
  currentTime: number;
  relayNonce: number;
  poolCollateralDecimals: number;
  poolCollateralSymbol: string;
}

export interface BridgePoolDeploymentData {
  [key: string]: { timestamp: number };
}

export class InsuredBridgeL1Client {
  public readonly bridgeAdmin: BridgeAdminInterfaceWeb3;
  public readonly rateModelStore: RateModelStoreWeb3 | null; // Can be null if user doesn't want to compute any realized
  // LP fee %'s.
  public bridgePools: { [key: string]: BridgePoolData }; // L1TokenAddress=>BridgePoolData
  private whitelistedTokens: { [chainId: string]: { [l1TokenAddress: string]: string } } = {};

  // Accumulate updated rate model events after each update() call, which we'll use to update the rate model
  // dictionary.
  private updatedRateModelEventsForToken: across.rateModel.RateModelEvent[] = [];
  private rateModelDictionary: across.rateModel.RateModelDictionary;

  public optimisticOracleLiveness = 0;
  public firstBlockToSearch: number;

  private relays: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.
  private instantRelays: { [key: string]: { [key: string]: InstantRelay } } = {}; // L1TokenAddress=>{depositHash, realizedLpFeePct}=>InstantRelay.

  private readonly blockFinder: BlockFinder<BlockTransactionBase>;

  constructor(
    private readonly logger: Logger,
    readonly l1Web3: Web3,
    readonly bridgeAdminAddress: string,
    readonly rateModelStoreAddress: string | null,
    readonly startingBlockNumber = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    // Cast the following contracts to web3-specific type
    this.bridgeAdmin = (new l1Web3.eth.Contract(
      getAbi("BridgeAdminInterface"),
      bridgeAdminAddress
    ) as unknown) as BridgeAdminInterfaceWeb3;
    this.rateModelStore = rateModelStoreAddress
      ? ((new l1Web3.eth.Contract(getAbi("RateModelStore"), rateModelStoreAddress) as unknown) as RateModelStoreWeb3)
      : null;

    this.rateModelDictionary = new across.rateModel.RateModelDictionary();

    this.bridgePools = {}; // Initialize the bridgePools with no pools yet. Will be populated in the _initialSetup.

    this.firstBlockToSearch = startingBlockNumber;
    this.blockFinder = new BlockFinder<BlockTransactionBase>(this.l1Web3.eth.getBlock);
  }

  // Return an array of all bridgePool addresses
  getBridgePoolsAddresses(): string[] {
    this._throwIfNotInitialized();
    return Object.values(this.bridgePools).map((bridgePool: BridgePoolData) => bridgePool.contract.options.address);
  }

  getAllRelayedDeposits(): Relay[] {
    this._throwIfNotInitialized();
    return Object.keys(this.relays)
      .map((l1Token: string) =>
        Object.keys(this.relays[l1Token]).map((depositHash: string) => this.relays[l1Token][depositHash])
      )
      .flat();
  }

  getRelayedDepositsForL1Token(l1Token: string): Relay[] {
    this._throwIfNotInitialized();
    return Object.values(this.relays[l1Token]);
  }

  getRelayForDeposit(l1Token: string, deposit: Deposit): Relay | undefined {
    this._throwIfNotInitialized();
    return this.relays[l1Token][deposit.depositHash];
  }

  getBridgePoolDeployData(): BridgePoolDeploymentData {
    this._throwIfNotInitialized();
    const deployTimestamps: BridgePoolDeploymentData = {};
    Object.keys(this.bridgePools).map((l1Token: string) => {
      deployTimestamps[l1Token] = { timestamp: this.bridgePools[l1Token].earliestValidDepositQuoteTime };
    });
    return deployTimestamps;
  }
  getWhitelistedTokensForChainId(chainId: string): { [l1TokenAddress: string]: string } {
    this._throwIfNotInitialized();
    return this.whitelistedTokens[chainId];
  }

  getWhitelistedL2TokensForChainId(chainId: string): string[] {
    this._throwIfNotInitialized();
    return Object.values(this.getWhitelistedTokensForChainId(chainId));
  }

  getRateModelForBlockNumber(l1Token: string, blockNumber: number | undefined = undefined): across.constants.RateModel {
    this._throwIfNotInitialized();
    return this.rateModelDictionary.getRateModelForBlockNumber(l1Token, blockNumber);
  }

  getL1TokensFromRateModel(blockNumber: number | undefined = undefined): string[] {
    this._throwIfNotInitialized();
    return this.rateModelDictionary.getL1TokensFromRateModel(blockNumber);
  }

  hasInstantRelayer(l1Token: string, depositHash: string, realizedLpFeePct: string): boolean {
    this._throwIfNotInitialized();
    return this.getInstantRelayer(l1Token, depositHash, realizedLpFeePct) !== undefined;
  }

  getInstantRelayer(l1Token: string, depositHash: string, realizedLpFeePct: string): string | undefined {
    this._throwIfNotInitialized();
    const instantRelayDataHash = this._getInstantRelayHash(depositHash, realizedLpFeePct);
    return instantRelayDataHash !== null
      ? this.instantRelays[l1Token][instantRelayDataHash]?.instantRelayer
      : undefined;
  }

  // Return all relays in the Pending state, ordered by amount relayed.
  getPendingRelayedDeposits(): Relay[] {
    return this.getAllRelayedDeposits()
      .filter((relay: Relay) => relay.relayState === ClientRelayState.Pending)
      .sort((a, b) => (toBN(a.amount).lt(toBN(b.amount)) ? 1 : toBN(b.amount).lt(toBN(a.amount)) ? -1 : 0));
  }

  getPendingRelayedDepositsGroupedByL1Token(): { [key: string]: Relay[] } {
    const pendingRelayedDeposits = this.getPendingRelayedDeposits();
    const groupedL1Deposits: { [key: string]: Relay[] } = {};
    pendingRelayedDeposits.forEach((relay: Relay) => {
      if (groupedL1Deposits[relay.l1Token] === undefined) groupedL1Deposits[relay.l1Token] = [];
      groupedL1Deposits[relay.l1Token].push(relay);
    });
    return groupedL1Deposits;
  }

  getPendingRelayedDepositsForL1Token(l1Token: string): Relay[] {
    return this.getRelayedDepositsForL1Token(l1Token).filter(
      (relay: Relay) => relay.relayState === ClientRelayState.Pending
    );
  }

  getSettleableRelayedDeposits(): Relay[] {
    return this.getAllRelayedDeposits().filter(
      (relay: Relay) =>
        relay.relayState === ClientRelayState.Pending && relay.settleable != SettleableRelay.CannotSettle
    );
  }

  getSettleableRelayedDepositsForL1Token(l1Token: string): Relay[] {
    return this.getRelayedDepositsForL1Token(l1Token).filter(
      (relay: Relay) =>
        relay.relayState === ClientRelayState.Pending && // The relay is in the Pending state.
        relay.settleable != SettleableRelay.CannotSettle // The relay is not set to CannotSettle.
    );
  }

  async calculateRealizedLpFeePctForDeposit(deposit: Deposit): Promise<BN> {
    // The block number must be exactly the one containing the deposit.quoteTimestamp, so we use the lowest block delta
    // of 1. Setting averageBlockTime to 14 increases the speed at the cost of more web3 requests.
    const quoteBlockNumber = (await this.blockFinder.getBlockForTimestamp(deposit.quoteTimestamp)).number;
    const rateModelForBlockNumber = this.getRateModelForBlockNumber(deposit.l1Token, quoteBlockNumber);

    const bridgePool = this.getBridgePoolForDeposit(deposit).contract;
    const [liquidityUtilizationCurrent, liquidityUtilizationPostRelay] = await Promise.all([
      bridgePool.methods.liquidityUtilizationCurrent().call(undefined, quoteBlockNumber),
      bridgePool.methods.liquidityUtilizationPostRelay(deposit.amount.toString()).call(undefined, quoteBlockNumber),
    ]);

    this.logger.debug({
      at: "InsuredBridgeL1Client",
      message: "Computed realized LP fee % for deposit",
      deposit,
      quoteBlockNumber,
      liquidityUtilizationCurrent: liquidityUtilizationCurrent.toString(),
      liquidityUtilizationPostRelay: liquidityUtilizationPostRelay.toString(),
      rateModel: rateModelForBlockNumber,
    });

    return toBN(
      across.feeCalculator
        .calculateRealizedLpFeePct(
          rateModelForBlockNumber,
          liquidityUtilizationCurrent.toString(),
          liquidityUtilizationPostRelay.toString()
        )
        .toString()
    );
  }

  getDepositRelayState(l2Deposit: Deposit): ClientRelayState {
    const relay = this.relays[l2Deposit.l1Token][l2Deposit.depositHash];
    // If the relay is undefined then the deposit has not yet been sent on L1 and can be relayed.
    if (relay === undefined) return ClientRelayState.Uninitialized;
    // Else, if the relatable state is "Pending" then the deposit can be sped up to an instant relay.
    else if (relay.relayState === ClientRelayState.Pending) return ClientRelayState.Pending;
    // If neither condition is met then the relay is finalized.
    return ClientRelayState.Finalized;
  }

  getBridgePoolCollateralInfoForDeposit(l2Deposit: Deposit): { collateralDecimals: number; collateralSymbol: string } {
    if (!this.bridgePools[l2Deposit.l1Token]) throw new Error(`No bridge pool initialized for ${l2Deposit.l1Token}`);
    return {
      collateralDecimals: this.getBridgePoolForDeposit(l2Deposit).poolCollateralDecimals,
      collateralSymbol: this.getBridgePoolForDeposit(l2Deposit).poolCollateralSymbol,
    };
  }

  getBridgePoolForDeposit(l2Deposit: Deposit): BridgePoolData {
    if (!this.bridgePools[l2Deposit.l1Token]) throw new Error(`No bridge pool initialized for ${l2Deposit.l1Token}`);
    return this.getBridgePoolForL1Token(l2Deposit.l1Token);
  }

  getBridgePoolForL1Token(l1Token: string): BridgePoolData {
    if (!this.bridgePools[l1Token]) throw new Error(`No bridge pool initialized for ${l1Token}`);
    return this.bridgePools[l1Token];
  }

  getBridgePoolForL2Token(l2Token: string, chainId: string): BridgePoolData {
    const bridgePoolData = Object.values(this.bridgePools).find((bridgePool) => {
      return toChecksumAddress(bridgePool.l2Token[chainId]) === toChecksumAddress(l2Token);
    });
    if (!bridgePoolData) throw new Error(`No bridge pool initialized for ${l2Token} and chainID: ${chainId}`);
    return bridgePoolData;
  }

  async getProposerBondPct(): Promise<BN> {
    return toBN(await this.bridgeAdmin.methods.proposerBondPct().call());
  }

  // Returns the L2 Deposit box address for a given bridgeAdmin on L1.
  async getL2DepositBoxAddress(chainId: number): Promise<string> {
    const depositContracts = (await this.bridgeAdmin.methods.depositContracts(chainId).call()) as any;
    return depositContracts.depositContract || depositContracts[0]; // When latest BridgeAdmin is redeployed, can remove the "|| depositContracts[0]".
  }

  async update(): Promise<void> {
    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: this.endingBlockNumber || (await this.l1Web3.eth.getBlockNumber()),
    };
    if (blockSearchConfig.fromBlock > blockSearchConfig.toBlock) {
      this.logger.debug({
        at: "InsuredBridgeL1Client",
        message: "All blocks are searched, returning early",
        toBlock: blockSearchConfig.toBlock,
      });
      return;
    }

    // Check for new bridgePools deployed. This acts as the initial setup and acts to more pools if they are deployed
    // while the bot is running.
    const whitelistedTokenEvents = await this.bridgeAdmin.getPastEvents("WhitelistToken", blockSearchConfig);
    for (const whitelistedTokenEvent of whitelistedTokenEvents) {
      // Add L1=>L2 token mapping to whitelisted dictionary for this chain ID.
      const whitelistedTokenMappingsForChainId = this.whitelistedTokens[whitelistedTokenEvent.returnValues.chainId];
      this.whitelistedTokens[whitelistedTokenEvent.returnValues.chainId] = {
        ...whitelistedTokenMappingsForChainId,
        [toChecksumAddress(whitelistedTokenEvent.returnValues.l1Token)]: toChecksumAddress(
          whitelistedTokenEvent.returnValues.l2Token
        ),
      };

      const l1Token = toChecksumAddress(whitelistedTokenEvent.returnValues.l1Token);
      const l2Tokens = this.bridgePools[l1Token]?.l2Token;

      // Store the WhitelistToken event timestamp as the earliest allowable deposit quote time for relays that will go
      // through this bridge pool. If any relays have a quote time that is before the bridge pool was whitelisted,
      // then it is by default invalid.
      // Note: Only update this deployment time if the bridge pool address is reset.
      const existingBridgePoolAddress = this.bridgePools[l1Token]?.contract.options.address;
      const earliestValidDepositQuoteTime = Number(
        (await this.l1Web3.eth.getBlock(whitelistedTokenEvent.blockNumber)).timestamp
      );
      this.bridgePools[l1Token] = {
        l2Token: l2Tokens, // Re-use existing L2 token array and update after resetting other state.
        contract: (new this.l1Web3.eth.Contract(
          getAbi("BridgePool"),
          whitelistedTokenEvent.returnValues.bridgePool
        ) as unknown) as BridgePoolWeb3,
        earliestValidDepositQuoteTime:
          whitelistedTokenEvent.returnValues.bridgePool === existingBridgePoolAddress
            ? this.bridgePools[l1Token].earliestValidDepositQuoteTime
            : earliestValidDepositQuoteTime,
        // We'll set the following params when fetching bridge pool state in parallel.
        currentTime: 0,
        relayNonce: 0,
        poolCollateralDecimals: 0,
        poolCollateralSymbol: "",
      };

      // Associate whitelisted L2 token with chain ID for L2.
      this.bridgePools[l1Token].l2Token = {
        ...l2Tokens,
        [whitelistedTokenEvent.returnValues.chainId]: toChecksumAddress(whitelistedTokenEvent.returnValues.l2Token),
      };
      this.relays[l1Token] = {};
      this.instantRelays[l1Token] = {};
    }

    // Fetch and store all rate model updated events, which will be used to fetch the rate model for a specific deposit
    // quote timestamp.
    this.updatedRateModelEventsForToken = this.updatedRateModelEventsForToken.concat(
      await this._getAllRateModelEvents(blockSearchConfig)
    );
    this.rateModelDictionary.updateWithEvents(this.updatedRateModelEventsForToken);

    // Set the optimisticOracleLiveness. Note that if this value changes in the contract the bot will need to be
    // restarted to get the latest value. This is a fine assumption as: a) our production bots run in serverless mode
    // (restarting all the time) and b) this value changes very infrequently.
    if (this.optimisticOracleLiveness == 0)
      this.optimisticOracleLiveness = Number(await this.bridgeAdmin.methods.optimisticOracleLiveness().call());

    // Fetch event information
    // TODO: consider optimizing this further. Right now it will make a series of sequential BlueBird calls for each pool.
    for (const [l1Token, bridgePool] of Object.entries(this.bridgePools)) {
      const l1TokenInstance = new this.l1Web3.eth.Contract(getAbi("ERC20"), l1Token);
      const [
        depositRelayedEvents,
        relaySpedUpEvents,
        relaySettledEvents,
        relayDisputedEvents,
        relayCanceledEvents,
        contractTime,
        relayNonce,
        poolCollateralDecimals,
        poolCollateralSymbol,
      ] = await Promise.all([
        bridgePool.contract.getPastEvents("DepositRelayed", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelaySpedUp", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelaySettled", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelayDisputed", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelayCanceled", blockSearchConfig),
        bridgePool.contract.methods.getCurrentTime().call(),
        bridgePool.contract.methods.numberOfRelays().call(),
        l1TokenInstance.methods.decimals().call(),
        l1TokenInstance.methods.symbol().call(),
      ]);

      // Store current contract time and relay nonce that user can use to send instant relays (where there is no pending
      // relay) for a deposit. Store the l1Token decimals and symbol to enhance logging.
      bridgePool.currentTime = Number(contractTime);
      bridgePool.relayNonce = Number(relayNonce);
      bridgePool.poolCollateralDecimals = Number(poolCollateralDecimals);
      bridgePool.poolCollateralSymbol = poolCollateralSymbol;

      // Process events an set in state.
      for (const depositRelayedEvent of depositRelayedEvents) {
        const relayData: Relay = {
          relayId: Number(depositRelayedEvent.returnValues.relay.relayId),
          chainId: Number(depositRelayedEvent.returnValues.depositData.chainId),
          depositId: Number(depositRelayedEvent.returnValues.depositData.depositId),
          l2Sender: depositRelayedEvent.returnValues.depositData.l2Sender,
          slowRelayer: depositRelayedEvent.returnValues.relay.slowRelayer,
          l1Recipient: depositRelayedEvent.returnValues.depositData.l1Recipient,
          l1Token: l1Token,
          amount: depositRelayedEvent.returnValues.depositData.amount,
          slowRelayFeePct: depositRelayedEvent.returnValues.depositData.slowRelayFeePct,
          instantRelayFeePct: depositRelayedEvent.returnValues.depositData.instantRelayFeePct,
          quoteTimestamp: Number(depositRelayedEvent.returnValues.depositData.quoteTimestamp),
          realizedLpFeePct: depositRelayedEvent.returnValues.relay.realizedLpFeePct,
          priceRequestTime: Number(depositRelayedEvent.returnValues.relay.priceRequestTime),
          depositHash: depositRelayedEvent.returnValues.depositHash,
          relayState: ClientRelayState.Pending, // Should be equal to depositRelayedEvent.returnValues.relay.relayState
          relayAncillaryDataHash: depositRelayedEvent.returnValues.relayAncillaryDataHash,
          proposerBond: depositRelayedEvent.returnValues.relay.proposerBond,
          finalFee: depositRelayedEvent.returnValues.relay.finalFee,
          settleable: SettleableRelay.CannotSettle,
          blockNumber: depositRelayedEvent.blockNumber,
        };
        this.relays[l1Token][relayData.depositHash] = relayData;
      }

      // For all RelaySpedUp, set the instant relayer.
      for (const relaySpedUpEvent of relaySpedUpEvents) {
        const instantRelayDataHash = this._getInstantRelayHash(
          relaySpedUpEvent.returnValues.depositHash,
          relaySpedUpEvent.returnValues.relay.realizedLpFeePct
        );
        if (instantRelayDataHash !== null) {
          this.instantRelays[l1Token][instantRelayDataHash] = {
            instantRelayer: relaySpedUpEvent.returnValues.instantRelayer,
          };
        }
      }

      // If the latest stored relay hash matches a dispute event's relay hash, then delete the relay struct because
      // it has been disputed and deleted on-chain.
      const potentialDisputedRelays = relayDisputedEvents.concat(relayCanceledEvents);
      for (const relayDisputedEvent of potentialDisputedRelays) {
        const pendingRelay = this.relays[l1Token][relayDisputedEvent.returnValues.depositHash];
        const pendingRelayHash = this._getRelayHash(pendingRelay);

        if (pendingRelay && pendingRelayHash === relayDisputedEvent.returnValues.relayHash)
          delete this.relays[l1Token][relayDisputedEvent.returnValues.depositHash];
      }

      for (const relaySettledEvent of relaySettledEvents) {
        this.relays[l1Token][relaySettledEvent.returnValues.depositHash].relayState = ClientRelayState.Finalized;
        this.relays[l1Token][relaySettledEvent.returnValues.depositHash].settleable = SettleableRelay.CannotSettle;
      }

      for (const pendingRelay of this.getPendingRelayedDepositsForL1Token(l1Token)) {
        // If relay is pending and the time is past the OO liveness, then it is settleable by the slow relayer.
        if (bridgePool.currentTime >= pendingRelay.priceRequestTime + this.optimisticOracleLiveness) {
          this.relays[l1Token][pendingRelay.depositHash].settleable = SettleableRelay.SlowRelayerCanSettle;
        }
        // If relay is pending and the time is past the OO liveness +15 mins, then it is settleable by anyone.
        if (bridgePool.currentTime >= pendingRelay.priceRequestTime + this.optimisticOracleLiveness + 900) {
          this.relays[l1Token][pendingRelay.depositHash].settleable = SettleableRelay.AnyoneCanSettle;
        }
      }
    }
    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({
      at: "InsuredBridgeL1Client",
      message: "Insured bridge l1 client updated",
      l1TokensInRateModelDictionary: Object.keys(this.rateModelDictionary.rateModelDictionary),
    });
  }

  private async _getAllRateModelEvents(blockSearchConfig: any): Promise<across.rateModel.RateModelEvent[]> {
    if (this.rateModelStore === null) return [];
    else {
      const updatedRateModelEvents: across.rateModel.RateModelEvent[] = (
        await this.rateModelStore.getPastEvents("UpdatedRateModel", blockSearchConfig)
      ).map((rawEvent) => {
        return {
          blockNumber: rawEvent.blockNumber,
          transactionIndex: rawEvent.transactionIndex,
          logIndex: rawEvent.logIndex,
          rateModel: rawEvent.returnValues.rateModel,
          l1Token: rawEvent.returnValues.l1Token,
        };
      });
      return updatedRateModelEvents;
    }
  }

  private _getInstantRelayHash(depositHash: string, realizedLpFeePct: string): string | null {
    const instantRelayDataHash = soliditySha3(
      this.l1Web3.eth.abi.encodeParameters(["bytes32", "uint64"], [depositHash, realizedLpFeePct])
    );
    return instantRelayDataHash;
  }

  private _getRelayHash = (relay: Relay) => {
    return soliditySha3(
      this.l1Web3.eth.abi.encodeParameters(
        ["uint256", "address", "uint32", "uint64", "uint256", "uint256", "uint256"],
        [
          relay.relayState,
          relay.slowRelayer,
          relay.relayId,
          relay.realizedLpFeePct,
          relay.priceRequestTime,
          relay.proposerBond,
          relay.finalFee,
        ]
      )
    );
  };

  private _throwIfNotInitialized() {
    if (Object.keys(this.bridgePools).length == 0)
      throw new Error("InsuredBridgeClient method called before initialization! Call `update` first.");
  }
}
