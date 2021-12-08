import type { BridgePoolData } from "@uma/financial-templates-lib";

// Note that Relay parameters are narrower in this module than in @uma/financial-templates-lib.
interface Relay {
  chainId: number;
  depositId: number;
  l2Sender: string;
  l1Recipient: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  realizedLpFeePct: string;
  depositHash: string;
  relayAncillaryDataHash: string;
}

export class RelayEventFetcher {
  public bridgePools: { [key: string]: BridgePoolData } = {};

  private lastRelayUpdate = -1; // DepositRelayed events are fetched from lastRelayUpdate + 1 block.

  // relays and deposits contain the same data from DepositRelayed events, just accessible by relay and deposit hashes respectively.
  private relays: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>relayHash=>Relay.
  private deposits: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.

  constructor() {
    // do nothing.
  }

  // update() should be called only after having populated bridgePools.
  // This fetches all DepositRelayed events since lastRelayUpdate block in order to store deposit and relay hash mappings that could be referenced by other events.
  async update(endingBlock: number): Promise<void> {
    // Only update if endingBlock is more recent than the lastRelayUpdate block from last update() call.
    const startingBlock = this.lastRelayUpdate + 1;
    if (startingBlock > endingBlock) {
      return;
    }

    // Populate empty relay and deposit objects for each discovered bridge pool collaterals on the first update.
    for (const L1TokenAddress of Object.keys(this.bridgePools)) {
      this.relays[L1TokenAddress] = this.relays[L1TokenAddress] ? this.relays[L1TokenAddress] : {};
      this.deposits[L1TokenAddress] = this.deposits[L1TokenAddress] ? this.deposits[L1TokenAddress] : {};
    }

    await Promise.all(
      Object.keys(this.bridgePools).map(async (L1TokenAddress) => {
        const depositRelayedEvents = await this.bridgePools[L1TokenAddress].contract.getPastEvents("DepositRelayed", {
          fromBlock: startingBlock,
          toBlock: endingBlock,
        });
        for (const depositRelayedEvent of depositRelayedEvents) {
          const relayData: Relay = {
            chainId: Number(depositRelayedEvent.returnValues.depositData.chainId),
            depositId: Number(depositRelayedEvent.returnValues.depositData.depositId),
            l2Sender: depositRelayedEvent.returnValues.depositData.l2Sender,
            l1Recipient: depositRelayedEvent.returnValues.depositData.l1Recipient,
            amount: depositRelayedEvent.returnValues.depositData.amount,
            slowRelayFeePct: depositRelayedEvent.returnValues.depositData.slowRelayFeePct,
            instantRelayFeePct: depositRelayedEvent.returnValues.depositData.instantRelayFeePct,
            realizedLpFeePct: depositRelayedEvent.returnValues.relay.realizedLpFeePct,
            depositHash: depositRelayedEvent.returnValues.depositHash,
            relayAncillaryDataHash: depositRelayedEvent.returnValues.relayAncillaryDataHash,
          };
          this.relays[L1TokenAddress][relayData.relayAncillaryDataHash] = relayData;
          this.deposits[L1TokenAddress][relayData.depositHash] = relayData;
          console.log(relayData);
        }
      })
    );

    this.lastRelayUpdate = endingBlock;
  }

  async getEvents(): Promise<void> {
    // do nothing.
  }
}
