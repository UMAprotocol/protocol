import type { BridgePoolData, InsuredBridgeL1Client } from "@uma/financial-templates-lib";
import { EventData } from "web3-eth-contract";

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
}

export interface EventInfo {
  l1Token: string;
  poolCollateralDecimals: number;
  poolCollateralSymbol: string;
  relay: Relay;
  caller: string;
  action: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export class RelayEventProcessor {
  public bridgePools: { [key: string]: BridgePoolData } = {};

  private lastRelayUpdate = -1; // DepositRelayed events are fetched from lastRelayUpdate + 1 block.

  private deposits: { [key: string]: { [key: string]: Relay } } = {}; // L1TokenAddress=>depositHash=>Relay.
  private eventActions: { [key: string]: string } = {
    DepositRelayed: "slow relayed",
    RelaySpedUp: "sped up",
    RelaySettled: "settled",
    RelayDisputed: "disputed",
    RelayCanceled: "canceled",
  };

  constructor(readonly l1Client: InsuredBridgeL1Client) {
    // do nothing.
  }

  // update() should be called only after having updated L1 client
  // This fetches all DepositRelayed events since lastRelayUpdate block in order to store deposit and relay hash
  // mappings that could be referenced by other events.
  update(endingBlock: number): void {
    // Only update if endingBlock is more recent than the lastRelayUpdate block from last update() call.
    const startingBlock = this.lastRelayUpdate + 1;
    if (startingBlock > endingBlock) {
      return;
    }

    // Populate empty deposit object for each discovered bridge pool collaterals on the first update.
    for (const l1TokenAddress of Object.keys(this.bridgePools)) {
      this.deposits[l1TokenAddress] = this.deposits[l1TokenAddress] ? this.deposits[l1TokenAddress] : {};
    }

    for (const relayData of this.l1Client.getAllRelayedDeposits()) {
      this.deposits[relayData.l1Token][relayData.depositHash] = relayData;
    }

    this.lastRelayUpdate = endingBlock;
  }

  getRelayEventInfo(startingBlock: number | undefined, endingBlock: number | undefined): EventInfo[] {
    const relayEvents: EventInfo[] = [];
    // Fetch all relay related events.
    for (const [l1TokenAddress, bridgePool] of Object.entries(this.bridgePools)) {
      // Process all relay related events, get caller, type and match with additional properties by depositHash that
      // were cached on update().
      const allEvents = this.l1Client.allRelayEventData[bridgePool.contract.options.address].filter(
        (e: EventData) =>
          (startingBlock === undefined || e.blockNumber >= startingBlock) &&
          (endingBlock === undefined || e.blockNumber <= endingBlock)
      );
      for (const event of allEvents) {
        const depositHash = event.returnValues.depositHash;
        if (!this.deposits[l1TokenAddress][depositHash]) {
          throw new Error(`No relay transacion found for l1Token: ${l1TokenAddress} and depositHash: ${depositHash}`);
        }
        let caller: string;
        switch (event.event) {
          case "DepositRelayed":
            caller = event.returnValues.relay.slowRelayer;
            break;
          case "RelaySpedUp":
            caller = event.returnValues.instantRelayer;
            break;
          case "RelaySettled":
            caller = event.returnValues.caller;
            break;
          default:
            caller = event.returnValues.disputer;
            break;
        }
        const relayEvent: EventInfo = {
          l1Token: l1TokenAddress,
          poolCollateralDecimals: this.bridgePools[l1TokenAddress].poolCollateralDecimals,
          poolCollateralSymbol: this.bridgePools[l1TokenAddress].poolCollateralSymbol,
          relay: this.deposits[l1TokenAddress][depositHash],
          caller: caller,
          action: this.eventActions[event.event],
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          logIndex: event.logIndex,
        };
        relayEvents.push(relayEvent);
      }
    }

    // Primary sort on block number. Secondary sort on logIndex.
    relayEvents.sort((a, b) => {
      if (a.blockNumber != b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      return a.logIndex - b.logIndex;
    });

    // Merge consecutive DepositRelayed and RelaySpedUp events from the same caller.
    for (let i = 1; i < relayEvents.length; i++) {
      if (
        relayEvents[i - 1] &&
        relayEvents[i] &&
        relayEvents[i].relay.depositHash === relayEvents[i - 1].relay.depositHash &&
        relayEvents[i].action === "sped up" &&
        relayEvents[i - 1].action === "slow relayed" &&
        relayEvents[i].transactionHash === relayEvents[i - 1].transactionHash &&
        relayEvents[i].caller === relayEvents[i - 1].caller
      ) {
        relayEvents[i].action = "instant relayed";
        relayEvents.splice(i - 1, 1);
        i--;
      }
    }
    return relayEvents;
  }
}
