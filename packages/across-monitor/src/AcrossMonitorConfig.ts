import assert from "assert";
import Web3 from "web3";
const { toChecksumAddress } = Web3.utils;

export interface ProcessEnv {
  [key: string]: string | undefined;
}

// Set modes to true that you want to enable in the AcrossMonitor bot.
export interface BotModes {
  utilizationEnabled: boolean; // Monitors pool utilization ratio
  unknownRelayersEnabled: boolean; // Monitors relay related events triggered by non-whitelisted addresses
}

export class AcrossMonitorConfig {
  readonly bridgeAdminChainId: number;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  readonly startingBlock: number | undefined;
  readonly endingBlock: number | undefined;

  readonly utilizationThreshold: number;
  readonly whitelistedAddresses: string[];
  readonly botModes: BotModes;

  constructor(env: ProcessEnv) {
    const {
      BRIDGE_ADMIN_CHAIN_ID,
      POLLING_DELAY,
      ERROR_RETRIES,
      ERROR_RETRIES_TIMEOUT,
      STARTING_BLOCK_NUMBER,
      ENDING_BLOCK_NUMBER,
      UTILIZATION_THRESHOLD,
      WHITELISTED_ADDRESSES,
      UTILIZATION_ENABLED,
      UNKNOWN_RELAYERS_ENABLED,
    } = env;

    this.botModes = {
      utilizationEnabled: UTILIZATION_ENABLED === "true" ? true : false,
      unknownRelayersEnabled: UNKNOWN_RELAYERS_ENABLED === "true" ? true : false,
    };

    // Default pool utilization threshold at 90%.
    this.utilizationThreshold = UTILIZATION_THRESHOLD ? Number(UTILIZATION_THRESHOLD) : 90;

    assert(this.utilizationThreshold <= 100, "UTILIZATION_THRESHOLD must be <= 100");
    assert(this.utilizationThreshold >= 0, "UTILIZATION_THRESHOLD must be >= 0");

    this.whitelistedAddresses = WHITELISTED_ADDRESSES ? JSON.parse(WHITELISTED_ADDRESSES) : [];
    for (let i = 0; i < this.whitelistedAddresses.length; i++) {
      this.whitelistedAddresses[i] = toChecksumAddress(this.whitelistedAddresses[i]);
    }

    // Default bridge pools on mainnet.
    this.bridgeAdminChainId = BRIDGE_ADMIN_CHAIN_ID ? Number(BRIDGE_ADMIN_CHAIN_ID) : 1;

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;

    // In serverless mode use block range from environment to fetch for latest events.
    this.startingBlock = STARTING_BLOCK_NUMBER ? Number(STARTING_BLOCK_NUMBER) : undefined;
    this.endingBlock = ENDING_BLOCK_NUMBER ? Number(ENDING_BLOCK_NUMBER) : undefined;
  }
}
