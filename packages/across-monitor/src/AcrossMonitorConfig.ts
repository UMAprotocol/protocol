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

// Following settings can be overridden to optimize L1 event search for select events. For example,
// the "DepositRelayed" event search request could return > 10,000 return values so we need to shorten the block
// search using these parameters because some node providers like Infura limit event search return values to 10,000.

// This is set to the oldest SpokePool's deploy block height because we can assume that there will not be any
// BridgePool events on any BridgePool at blocks lower than this height. This is specifically the WETH
// BridgePool's deploy block.
export const bridgePoolEarliestBlockToSearch = 13545377;
export const bridgePoolMaxBlocksToSeach = 1_000_000;

export class AcrossMonitorConfig {
  readonly bridgeAdminChainId: number;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  readonly startingBlock: number | undefined;
  readonly endingBlock: number | undefined;
  readonly bridgePoolEarliestBlockToSearch: number;
  readonly bridgePoolMaxBlocksToSeach: number;

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
      BRIDGE_POOL_EVENT_SEARCH_FROM_BLOCK,
      BRIDGE_POOL_MAX_BLOCKS_TO_SEARCH,
    } = env;

    this.botModes = {
      utilizationEnabled: UTILIZATION_ENABLED === "true" ? true : false,
      unknownRelayersEnabled: UNKNOWN_RELAYERS_ENABLED === "true" ? true : false,
    };

    // Default pool utilization threshold at 90%.
    this.utilizationThreshold = UTILIZATION_THRESHOLD ? Number(UTILIZATION_THRESHOLD) : 90;

    if (this.utilizationThreshold > 100) throw new Error("UTILIZATION_THRESHOLD must be <= 100");
    if (this.utilizationThreshold < 0) throw new Error("UTILIZATION_THRESHOLD must be >= 0");

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

    this.bridgePoolEarliestBlockToSearch = BRIDGE_POOL_EVENT_SEARCH_FROM_BLOCK
      ? Number(BRIDGE_POOL_EVENT_SEARCH_FROM_BLOCK)
      : bridgePoolEarliestBlockToSearch;
    this.bridgePoolMaxBlocksToSeach = BRIDGE_POOL_MAX_BLOCKS_TO_SEARCH
      ? Number(BRIDGE_POOL_MAX_BLOCKS_TO_SEARCH)
      : bridgePoolMaxBlocksToSeach;
  }
}
