import Web3 from "web3";
const { toBN } = Web3.utils;

import { ZERO_ADDRESS } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { Deposit } from "./InsuredBridgeL2Client";

import type { BridgeAdminWeb3, BridgePoolWeb3 } from "@uma/contracts-node";
import type { BN } from "@uma/common";
import type { Logger } from "winston";

enum RelayState {
  Pending,
  SpedUp,
  Disputed,
  Finalized,
}

export enum RelayAbility {
  Any, // Deposit on L2, nothing yet on L1. Can be slow relayed and can be sped up.
  SpeedUpOnly, // Deposit on L2 and has been slow relayed on L1. Can be sped up to instantly relay.
  None, // Relay has been finalized through slow relay passed liveness or instantly relayed. Cant do anything.
}

export interface Relay {
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
  relayState: RelayState;
}

export class InsuredBridgeL1Client {
  public readonly bridgeAdmin: BridgeAdminWeb3;
  public bridgePools: { [key: string]: BridgePoolWeb3 }; // L1TokenAddress=>BridgePoolClient

  private relays: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.

  private firstBlockToSearch: number;

  private readonly toWei = Web3.utils.toWei;

  constructor(
    private readonly logger: Logger,
    readonly l1Web3: Web3,
    readonly bridgeAdminAddress: string,
    readonly startingBlockNumber = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    this.bridgeAdmin = (new l1Web3.eth.Contract(
      getAbi("BridgeAdmin"),
      bridgeAdminAddress
    ) as unknown) as BridgeAdminWeb3; // Cast to web3-specific type

    this.bridgePools = {}; // Initialize the bridgePools with no pools yet. Will be populated in the _initialSetup.

    this.firstBlockToSearch = startingBlockNumber;
  }

  // Return an array of all bridgePool addresses
  getBridgePoolsAddresses(): string[] {
    this._throwIfNotInitialized();
    return Object.values(this.bridgePools).map((bridgePool: BridgePoolWeb3) => bridgePool.options.address);
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

  getPendingRelayedDeposits(): Relay[] {
    return this.getAllRelayedDeposits().filter((relay: Relay) => relay.relayState === RelayState.Pending);
  }

  getPendingRelayedDepositsForL1Token(l1Token: string): Relay[] {
    return this.getRelayedDepositsForL1Token(l1Token).filter((relay: Relay) => relay.relayState === RelayState.Pending);
  }

  async calculateRealizedLpFeePctForDeposit(deposit: Deposit): Promise<BN> {
    console.log(deposit);
    return toBN(this.toWei("0.05"));
  }

  getDepositRelayAbility(l2Deposit: Deposit): RelayAbility {
    const relay = this.relays[l2Deposit.l1Token][l2Deposit.depositHash];
    // If the relay is undefined then the deposit has not yet been sent on L1 and can be relayed.
    if (relay === undefined) return RelayAbility.Any;
    // Else, if the relatable state is "Pending" then the deposit can be sped up to an instant relay.
    else if (relay.relayState === RelayState.Pending) return RelayAbility.SpeedUpOnly;
    // If neither condition is met then the relay is finalized.
    return RelayAbility.None;
  }

  getBridgePoolForDeposit(l2Deposit: Deposit): BridgePoolWeb3 {
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
      // If the data structure already contains information on this l1Token( re-whitelist of an existing token) continue.
      if (this.bridgePools[l1Token]) continue;
      // Else, we set the bridge pool to be a contract instance at the address of the bridge pool.
      this.bridgePools[l1Token] = (new this.l1Web3.eth.Contract(
        getAbi("BridgePool"),
        whitelistedTokenEvent.returnValues.bridgePool
      ) as unknown) as BridgePoolWeb3;
      this.relays[l1Token] = {};
    }

    // Fetch event information
    // TODO: consider optimizing this further. Right now it will make a series of sequential BlueBird calls for each pool.
    for (const [l1Token, bridgePool] of Object.entries(this.bridgePools)) {
      const [depositRelayedEvents, relaySpedUpEvents, relayDisputedEvents, relaySettledEvents] = await Promise.all([
        bridgePool.getPastEvents("DepositRelayed", blockSearchConfig),
        bridgePool.getPastEvents("RelaySpedUp", blockSearchConfig),
        bridgePool.getPastEvents("RelayDisputed", blockSearchConfig),
        bridgePool.getPastEvents("RelaySettled", blockSearchConfig),
      ]);

      for (const depositRelayedEvent of depositRelayedEvents) {
        const relayData = {
          depositId: Number(depositRelayedEvent.returnValues.depositId),
          sender: depositRelayedEvent.returnValues.sender,
          slowRelayer: depositRelayedEvent.returnValues.slowRelayer,
          disputedSlowRelayers: [],
          instantRelayer: ZERO_ADDRESS,
          depositTimestamp: depositRelayedEvent.returnValues.depositTimestamp,
          recipient: depositRelayedEvent.returnValues.recipient,
          l1Token: depositRelayedEvent.returnValues.l1Token,
          amount: depositRelayedEvent.returnValues.amount,
          slowRelayFeePct: depositRelayedEvent.returnValues.slowRelayFeePct,
          instantRelayFeePct: depositRelayedEvent.returnValues.instantRelayFeePct,
          realizedLpFeePct: depositRelayedEvent.returnValues.realizedLpFeePct,
          priceRequestAncillaryDataHash: depositRelayedEvent.returnValues.priceRequestAncillaryDataHash,
          depositHash: depositRelayedEvent.returnValues.depositHash,
          depositContract: depositRelayedEvent.returnValues.depositContract,
          relayState: RelayState.Pending,
        };

        // If the local data contains this deposit ID then this is a re-relay of a disputed relay. In this case, we need
        // to update the data accordingly as well as store the previous slow relayers.
        if (this.relays[l1Token][relayData.depositHash]) {
          // Bring the previous slow relayer from the data from the previous run and store it.
          const previousSlowRelayer = this.relays[l1Token][relayData.depositHash].slowRelayer;
          this.relays[l1Token][relayData.depositHash].disputedSlowRelayers.push(previousSlowRelayer);
          this.relays[l1Token][relayData.depositHash].slowRelayer = relayData.slowRelayer;
        }
        // Else, if this if this is the first time we see this deposit hash, then store it.
        else this.relays[l1Token][relayData.depositHash] = relayData;
      }

      // For all RelaySpedUp, set the instant relayer and set the state to SpedUp.
      for (const relaySpedUpEvent of relaySpedUpEvents) {
        this.relays[l1Token][relaySpedUpEvent.returnValues.depositHash].instantRelayer =
          relaySpedUpEvent.returnValues.instantRelayer;
        this.relays[l1Token][relaySpedUpEvent.returnValues.depositHash].relayState = RelayState.SpedUp;
      }

      // For all RelayDisputed, set the state of the relay to disputed.
      for (const relayDisputedEvent of relayDisputedEvents) {
        this.relays[l1Token][relayDisputedEvent.returnValues.depositHash].relayState = RelayState.Disputed;
      }

      for (const relaySettledEvent of relaySettledEvents) {
        this.relays[l1Token][relaySettledEvent.returnValues.depositHash].relayState = RelayState.Finalized;
      }
    }
    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({ at: "InsuredBridgeL1Client", message: "Insured bridge l1 client updated" });
  }

  private _throwIfNotInitialized() {
    if (Object.keys(this.bridgePools).length == 0)
      throw new Error("InsuredBridgeClient method called before initialization! Call `update` first.");
  }
}
