import Web3 from "web3";
const { toBN, toWei, toChecksumAddress } = Web3.utils;

import winston from "winston";

import { createEtherscanLinkMarkdown, createFormatFunction, PublicNetworks } from "@uma/common";

import { RelayEventProcessor } from "./RelayEventProcessor";

import type { BridgePoolData, InsuredBridgeL1Client } from "@uma/financial-templates-lib";
import type { AcrossMonitorConfig } from "./AcrossMonitorConfig";
import type { EventInfo } from "./RelayEventProcessor";

export class AcrossMonitor {
  // Discovered bridge pools are populated after update().
  public bridgePools: { [key: string]: BridgePoolData } = {};

  // Block range to search is only defined on calling update().
  private startingBlock: number | undefined = undefined;
  private endingBlock: number | undefined = undefined;

  // relayEventProcessor Module used to fetch and process relay events.
  private relayEventProcessor: RelayEventProcessor;

  /**
   * @notice Constructs new AcrossMonitor Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} monitorConfig Across monitor configuration parameters.
   * @param {Object} l1Client InsuredBridgeL1Client used for bridge pool discovery.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly monitorConfig: AcrossMonitorConfig,
    readonly l1Client: InsuredBridgeL1Client
  ) {
    this.relayEventProcessor = new RelayEventProcessor();
  }

  async update(): Promise<void> {
    // Update l1Client for bridge pool discovery.
    await this.l1Client.update();
    this.bridgePools = this.l1Client.bridgePools;
    this.relayEventProcessor.bridgePools = this.l1Client.bridgePools;

    // In serverless mode (pollingDelay === 0) use block range from environment (or just the latest block if not
    // provided) to fetch for latest events.
    // Else, if running in loop mode (pollingDelay != 0), start with the latest block and on next loops continue from
    // where the last one ended.
    const latestL1BlockNumber = await this.l1Client.l1Web3.eth.getBlockNumber();
    if (this.monitorConfig.pollingDelay === 0) {
      this.startingBlock =
        this.monitorConfig.startingBlock !== undefined ? this.monitorConfig.startingBlock : latestL1BlockNumber;
      this.endingBlock =
        this.monitorConfig.endingBlock !== undefined ? this.monitorConfig.endingBlock : latestL1BlockNumber;
    } else {
      this.startingBlock = this.endingBlock ? this.endingBlock + 1 : latestL1BlockNumber;
      this.endingBlock = latestL1BlockNumber;
    }
    // Starting block should not be after the ending block (this could happen on short polling period or
    // misconfiguration).
    this.startingBlock = Math.min(this.startingBlock, this.endingBlock);

    await this.relayEventProcessor.update(this.endingBlock);
  }

  async checkUtilization(): Promise<void> {
    this.logger.debug({ at: "AcrossMonitor#Utilization", message: "Checking for pool utilization ratio" });

    // Collect utilization and other properties for all bridge pools.
    const bridgePools = await Promise.all(
      Object.keys(this.bridgePools).map(async (l1TokenAddress) => {
        const utilization = await this.bridgePools[l1TokenAddress].contract.methods
          .liquidityUtilizationCurrent()
          .call();
        return {
          address: this.bridgePools[l1TokenAddress].contract.options.address,
          chainId: this.monitorConfig.bridgeAdminChainId,
          poolCollateralSymbol: this.bridgePools[l1TokenAddress].poolCollateralSymbol,
          utilization: utilization,
        };
      })
    );

    // Send notification if pool utilization is above configured threshold.
    for (const bridgePool of bridgePools) {
      if (
        toBN(bridgePool.utilization).gt(
          toBN(this.monitorConfig.utilizationThreshold)
            .mul(toBN(toWei("1")))
            .div(toBN(100))
        )
      ) {
        this.logger.warn({
          at: "UtilizationMonitor",
          message: "Across bridge pool utilization warning🏊",
          mrkdwn:
            bridgePool.poolCollateralSymbol +
            " bridge pool at " +
            createEtherscanLinkMarkdown(bridgePool.address, bridgePool.chainId) +
            " on " +
            PublicNetworks[bridgePool.chainId]?.name +
            " is at " +
            createFormatFunction(0, 2)(toBN(bridgePool.utilization).mul(toBN(100))) +
            "% utilization!",
          notificationPath: "risk-management",
        });
      }
    }

    return;
  }

  async checkUnknownRelayers(): Promise<void> {
    this.logger.debug({ at: "AcrossMonitor#UnknownRelayers", message: "Checking for unknown relayers" });

    const relayEvents: EventInfo[] = await this.relayEventProcessor.getRelayEventInfo(
      this.startingBlock,
      this.endingBlock
    );
    for (const event of relayEvents) {
      // Skip notifications for known relay caller addresses.
      if (this.monitorConfig.whitelistedAddresses.includes(toChecksumAddress(event.caller))) {
        continue;
      }

      this.logger.warn({
        at: "UnknownRelayers",
        message: "Across bridge pool unknown relayer warning🥷",
        mrkdwn:
          createEtherscanLinkMarkdown(event.caller, this.monitorConfig.bridgeAdminChainId) +
          " " +
          event.action +
          " depositId " +
          event.relay.depositId +
          " on " +
          PublicNetworks[event.relay.chainId]?.name +
          " of " +
          createFormatFunction(2, 4, false, event.poolCollateralDecimals)(event.relay.amount) +
          " " +
          event.poolCollateralSymbol +
          " from " +
          createEtherscanLinkMarkdown(event.relay.l2Sender, event.relay.chainId) +
          " to " +
          createEtherscanLinkMarkdown(event.relay.l1Recipient, this.monitorConfig.bridgeAdminChainId) +
          ". slowRelayFee " +
          createFormatFunction(2, 4, false, 18)(toBN(event.relay.slowRelayFeePct).muln(100)) +
          "%, instantRelayFee " +
          createFormatFunction(2, 4, false, 18)(toBN(event.relay.instantRelayFeePct).muln(100)) +
          "%, realizedLpFee " +
          createFormatFunction(2, 4, false, 18)(toBN(event.relay.realizedLpFeePct).muln(100)) +
          "%.",
        notificationPath: "risk-management",
      });
    }
  }
}
