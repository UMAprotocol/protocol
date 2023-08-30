interface BlockConfig {
  oneHour: number;
  maxBlockLookBack: number;
}

/**
 * Default configuration for different blockchain networks.
 * Each network is identified by its chain ID.
 */
export const blockDefaults: Record<string, BlockConfig> = {
  "1": {
    // Mainnet configuration
    oneHour: 300, // Approximate number of blocks mined in one hour (12 seconds per block)
    maxBlockLookBack: 20000, // Maximum number of blocks to look back for events
  },
  "137": {
    // Polygon (Matic) configuration
    oneHour: 1800, // Approximate number of blocks mined in one hour (2 seconds per block)
    maxBlockLookBack: 3499, // Maximum number of blocks to look back for events
  },
  "10": {
    // Optimism configuration
    oneHour: 1800, // Approximate number of blocks mined in one hour (2 seconds per block)
    maxBlockLookBack: 10000, // Maximum number of blocks to look back for events
  },
  "42161": {
    // Arbitrum configuration
    oneHour: 240, // Approximate number of blocks mined in one hour (15 seconds per block)
    maxBlockLookBack: 10000, // Maximum number of blocks to look back for events
  },
  "43114": {
    // Avalanche configuration
    oneHour: 1800, // Approximate number of blocks mined in one hour (2 seconds per block)
    maxBlockLookBack: 2000, // Maximum number of blocks to look back for events
  },
  other: {
    // Default configuration for other networks
    oneHour: 240, // Approximate number of blocks mined in one hour (15 seconds per block)
    maxBlockLookBack: 1000, // Maximum number of blocks to look back for events
  },
};
