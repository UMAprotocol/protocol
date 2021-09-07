import { ZERO_ADDRESS } from "@uma/common";
import { Abi } from "../types";
import type { BridgeAdminWeb3, BridgePoolWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import type { Logger } from "winston";

enum relayState {
  Pending,
  SpedUp,
  Disputed,
  Finalized,
}

interface Relay {
  relayTimestamp: number;
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
  relayState: relayState;
}

export class InsuredBridgeL1Client {
  public readonly bridgeAdmin: BridgeAdminWeb3;
  public bridgePools: { [key: string]: BridgePoolWeb3 }; // L1TokenAddress=>BridgePoolClient

  private relays: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.

  private firstBlockToSearch: number;

  constructor(
    private readonly logger: Logger,
    readonly bridgeAdminAbi: Abi,
    readonly bridgePoolAbi: Abi,
    readonly l1Web3: Web3,
    readonly bridgeAdminAddress: string,
    readonly startingBlockNumber = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    this.bridgeAdmin = (new l1Web3.eth.Contract(
      bridgeAdminAbi,
      bridgeAdminAddress
    ) as unknown) as InsuredBridgeL1Client["bridgeAdmin"]; // Cast to web3-specific type

    this.bridgePools = {}; // Initialize the bridgePools with no pools yet. Will be populated in the _initialSetup.

    this.firstBlockToSearch = startingBlockNumber;
  }

  // Return an array of all bridgePool addresses
  getBridgePoolsAddresses() {
    this._throwIfNotInitialized();
    return Object.values(this.bridgePools).map((bridgePool: BridgePoolWeb3) => bridgePool.options.address);
  }

  getAllRelayedDeposits() {
    this._throwIfNotInitialized();
    return Object.keys(this.relays)
      .map((l1Token: string) =>
        Object.keys(this.relays[l1Token]).map((depositHash: string) => this.relays[l1Token][depositHash])
      )
      .flat();
  }

  getRelayedDepositsForL1Token(l1Token: string) {
    this._throwIfNotInitialized();
    return Object.values(this.relays[l1Token]);
  }

  getPendingRelayedDeposits() {
    return this.getAllRelayedDeposits().filter((relay: Relay) => relay.relayState === relayState.Pending);
  }

  getPendingRelayedDepositsForL1Token(l1Token: string) {
    return this.getRelayedDepositsForL1Token(l1Token).filter((relay: Relay) => relay.relayState === relayState.Pending);
  }

  // TODO: we might want to add other accessors that do other forms of filtering.

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
        this.bridgePoolAbi,
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
        // TODO: Pull this async function call into above Promise.all if possible.
        const relayDataForDeposit = await this.bridgePools[depositRelayedEvent.returnValues.l1Token].methods
          .relays(depositRelayedEvent.returnValues.depositHash)
          .call();
        const relayData = {
          relayTimestamp: Number(relayDataForDeposit.priceRequestTime.toString()),
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
          relayState: relayState.Pending,
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
        this.relays[l1Token][relaySpedUpEvent.returnValues.depositHash].relayState = relayState.SpedUp;
      }

      // For all RelayDisputed, set the state of the relay to disputed.
      for (const relayDisputedEvent of relayDisputedEvents) {
        this.relays[l1Token][relayDisputedEvent.returnValues.depositHash].relayState = relayState.Disputed;
      }

      for (const relaySettledEvent of relaySettledEvents) {
        this.relays[l1Token][relaySettledEvent.returnValues.depositHash].relayState = relayState.Finalized;
      }
    }
    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({
      at: "InsuredBridgeL1Client",
      message: "Insured bridge l1 client updated",
    });
  }

  private _throwIfNotInitialized() {
    if (Object.keys(this.bridgePools).length == 0)
      throw new Error("InsuredBridgeClient method called before initialization! Call `update` first.");
  }
}
