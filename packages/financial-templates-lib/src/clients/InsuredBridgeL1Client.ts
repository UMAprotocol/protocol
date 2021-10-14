import Web3 from "web3";
const { toBN, soliditySha3 } = Web3.utils;

import { findBlockNumberAtTimestamp } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { Deposit } from "./InsuredBridgeL2Client";
import { RateModel, calculateRealizedLpFeePct } from "../helpers/acrossFeesCalculator";

import type { BridgeAdminInterfaceWeb3, BridgePoolWeb3 } from "@uma/contracts-node";
import type { Logger } from "winston";
import type { BN } from "@uma/common";

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
  disputedSlowRelayers: string[];
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
  relayHash: string;
  proposerBond: string;
  finalFee: string;
  settleable: SettleableRelay;
}

export interface InstantRelay {
  instantRelayer: string;
}

export interface BridgePoolData {
  contract: BridgePoolWeb3;
  currentTime: number;
  relayNonce: number;
}

export class InsuredBridgeL1Client {
  public readonly bridgeAdmin: BridgeAdminInterfaceWeb3;
  public bridgePools: { [key: string]: BridgePoolData }; // L1TokenAddress=>BridgePoolData
  public optimisticOracleLiveness = 0;

  private relays: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.
  private instantRelays: { [key: string]: { [key: string]: InstantRelay } } = {}; // L1TokenAddress=>{depositHash, realizedLpFeePct}=>InstantRelay.

  private firstBlockToSearch: number;
  private web3: Web3;

  constructor(
    private readonly logger: Logger,
    readonly l1Web3: Web3,
    readonly bridgeAdminAddress: string,
    readonly rateModels: { [key: string]: RateModel },
    readonly startingBlockNumber = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    this.bridgeAdmin = (new l1Web3.eth.Contract(
      getAbi("BridgeAdminInterface"),
      bridgeAdminAddress
    ) as unknown) as BridgeAdminInterfaceWeb3; // Cast to web3-specific type

    this.bridgePools = {}; // Initialize the bridgePools with no pools yet. Will be populated in the _initialSetup.

    this.firstBlockToSearch = startingBlockNumber;
    this.web3 = l1Web3;
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

  hasInstantRelayer(l1Token: string, depositHash: string, realizedLpFeePct: string): boolean {
    this._throwIfNotInitialized();
    const instantRelayDataHash = this._getInstantRelayHash(depositHash, realizedLpFeePct);
    return (
      instantRelayDataHash !== null &&
      this.instantRelays[l1Token][instantRelayDataHash] !== undefined &&
      this.instantRelays[l1Token][instantRelayDataHash].instantRelayer !== undefined
    );
  }

  getPendingRelayedDeposits(): Relay[] {
    return this.getAllRelayedDeposits().filter((relay: Relay) => relay.relayState === ClientRelayState.Pending);
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
        relay.relayState === ClientRelayState.Pending && relay.settleable != SettleableRelay.CannotSettle
    );
  }

  async calculateRealizedLpFeePctForDeposit(deposit: Deposit): Promise<BN> {
    if (this.rateModels === undefined || this.rateModels[deposit.l1Token] === undefined)
      throw new Error("No rate model for l1Token");

    const quoteBlockNumber = (await findBlockNumberAtTimestamp(this.l1Web3, deposit.quoteTimestamp)).blockNumber;
    const bridgePool = this.getBridgePoolForDeposit(deposit).contract;
    const [liquidityUtilizationCurrent, liquidityUtilizationPostRelay] = await Promise.all([
      bridgePool.methods.liquidityUtilizationCurrent().call(undefined, quoteBlockNumber),
      bridgePool.methods.liquidityUtilizationPostRelay(deposit.amount.toString()).call(undefined, quoteBlockNumber),
    ]);

    return calculateRealizedLpFeePct(
      this.rateModels[deposit.l1Token],
      toBN(liquidityUtilizationCurrent),
      toBN(liquidityUtilizationPostRelay)
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

  getBridgePoolForDeposit(l2Deposit: Deposit): BridgePoolData {
    if (!this.bridgePools[l2Deposit.l1Token]) throw new Error(`No bridge pool initialized for ${l2Deposit.l1Token}`);
    return this.bridgePools[l2Deposit.l1Token];
  }

  async getProposerBondPct(): Promise<BN> {
    return toBN(await this.bridgeAdmin.methods.proposerBondPct().call());
  }

  async update(): Promise<void> {
    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: this.endingBlockNumber || (await this.l1Web3.eth.getBlockNumber()),
    };

    // Check for new bridgePools deployed. This acts as the initial setup and acts to more pools if they are deployed
    // while the bot is running.
    const whitelistedTokenEvents = await this.bridgeAdmin.getPastEvents("WhitelistToken", blockSearchConfig);
    for (const whitelistedTokenEvent of whitelistedTokenEvents) {
      const l1Token = whitelistedTokenEvent.returnValues.l1Token;
      this.bridgePools[l1Token] = {
        contract: (new this.l1Web3.eth.Contract(
          getAbi("BridgePool"),
          whitelistedTokenEvent.returnValues.bridgePool
        ) as unknown) as BridgePoolWeb3,
        // We'll set the following params when fetching bridge pool state in parallel.
        currentTime: 0,
        relayNonce: 0,
      };
      this.relays[l1Token] = {};
      this.instantRelays[l1Token] = {};

      // Set the optimisticOracleLiveness. Note that if this value changes in the contract the bot will need to be
      // restarted to get the latest value. This is a fine assumption as: a) our production bots run in serverless mode
      // (restarting all the time) and b) this value changes very infrequently.
      if (this.optimisticOracleLiveness == 0)
        this.optimisticOracleLiveness = Number(await this.bridgeAdmin.methods.optimisticOracleLiveness().call());
    }

    // Set the optimisticOracleLiveness. Note that if this value changes in the contract the bot will need to be
    // restarted to get the latest value. This is a fine assumption as: a) our production bots run in serverless mode
    // (restarting all the time) and b) this value changes very infrequently.
    if (this.optimisticOracleLiveness == 0)
      this.optimisticOracleLiveness = Number(await this.bridgeAdmin.methods.optimisticOracleLiveness().call());

    // Fetch event information
    // TODO: consider optimizing this further. Right now it will make a series of sequential BlueBird calls for each pool.
    for (const [l1Token, bridgePool] of Object.entries(this.bridgePools)) {
      const [
        depositRelayedEvents,
        relaySpedUpEvents,
        relaySettledEvents,
        contractTime,
        relayNonce,
      ] = await Promise.all([
        bridgePool.contract.getPastEvents("DepositRelayed", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelaySpedUp", blockSearchConfig),
        bridgePool.contract.getPastEvents("RelaySettled", blockSearchConfig),
        bridgePool.contract.methods.getCurrentTime().call(),
        bridgePool.contract.methods.numberOfRelays().call(),
      ]);

      // Store current contract time and relay nonce that user can use to send instant relays
      // (where there is no pending relay) for a deposit.
      bridgePool.currentTime = Number(contractTime);
      bridgePool.relayNonce = Number(relayNonce);

      for (const depositRelayedEvent of depositRelayedEvents) {
        const relayData: Relay = {
          relayId: Number(depositRelayedEvent.returnValues.relay.relayId),
          chainId: Number(depositRelayedEvent.returnValues.depositData.chainId),
          depositId: Number(depositRelayedEvent.returnValues.depositData.depositId),
          l2Sender: depositRelayedEvent.returnValues.depositData.l2Sender,
          slowRelayer: depositRelayedEvent.returnValues.relay.slowRelayer,
          disputedSlowRelayers: [],
          l1Recipient: depositRelayedEvent.returnValues.depositData.l1Recipient,
          l1Token: depositRelayedEvent.returnValues.l1Token,
          amount: depositRelayedEvent.returnValues.depositData.amount,
          slowRelayFeePct: depositRelayedEvent.returnValues.depositData.slowRelayFeePct,
          instantRelayFeePct: depositRelayedEvent.returnValues.depositData.instantRelayFeePct,
          quoteTimestamp: Number(depositRelayedEvent.returnValues.depositData.quoteTimestamp),
          realizedLpFeePct: depositRelayedEvent.returnValues.relay.realizedLpFeePct,
          priceRequestTime: Number(depositRelayedEvent.returnValues.relay.priceRequestTime),
          depositHash: depositRelayedEvent.returnValues.depositHash,
          relayState: ClientRelayState.Pending, // Should be equal to depositRelayedEvent.returnValues.relay.relayState
          relayHash: depositRelayedEvent.returnValues.relayAncillaryDataHash,
          proposerBond: depositRelayedEvent.returnValues.relay.proposerBond,
          finalFee: depositRelayedEvent.returnValues.relay.finalFee,
          settleable: SettleableRelay.CannotSettle,
        };

        // If the local data contains this deposit ID then this is a re-relay of a disputed relay. In this case, we need
        // to update the data accordingly as well as store the previous slow relayers.
        if (this.relays[l1Token][relayData.depositHash]) {
          // Bring the previous slow relayer from the data from the previous run and store it.
          const previousSlowRelayer = this.relays[l1Token][relayData.depositHash].slowRelayer;
          this.relays[l1Token][relayData.depositHash].disputedSlowRelayers.push(previousSlowRelayer);
          this.relays[l1Token][relayData.depositHash].slowRelayer = relayData.slowRelayer;
          this.relays[l1Token][relayData.depositHash].relayId = relayData.relayId;
          this.relays[l1Token][relayData.depositHash].realizedLpFeePct = relayData.realizedLpFeePct;
          this.relays[l1Token][relayData.depositHash].priceRequestTime = relayData.priceRequestTime;
          // relayState should be the same.
        }
        // Else, if this if this is the first time we see this deposit hash, then store it.
        else this.relays[l1Token][relayData.depositHash] = relayData;
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
        if (bridgePool.currentTime >= pendingRelay.priceRequestTime + this.optimisticOracleLiveness + 54000) {
          this.relays[l1Token][pendingRelay.depositHash].settleable = SettleableRelay.AnyoneCanSettle;
        }
      }
    }
    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({ at: "InsuredBridgeL1Client", message: "Insured bridge l1 client updated" });
  }

  private _getInstantRelayHash(depositHash: string, realizedLpFeePct: string): string | null {
    const instantRelayDataHash = soliditySha3(
      this.web3.eth.abi.encodeParameters(["bytes32", "uint64"], [depositHash, realizedLpFeePct])
    );
    return instantRelayDataHash;
  }

  private _throwIfNotInitialized() {
    if (Object.keys(this.bridgePools).length == 0)
      throw new Error("InsuredBridgeClient method called before initialization! Call `update` first.");
  }
}
