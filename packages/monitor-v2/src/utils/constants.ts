export const blockDefaults = {
  "1": {
    // Mainnet
    oneHour: 300, // 12 seconds per block
    maxBlockLookBack: 20000,
  },
  "137": {
    // Polygon
    oneHour: 1800, // 2 seconds per block
    maxBlockLookBack: 3499,
  },
  "10": {
    // Optimism
    oneHour: 1800, // 2 seconds per block
    maxBlockLookBack: 10000,
  },
  "42161": {
    // Arbitrum
    oneHour: 240, // 15 seconds per block
    maxBlockLookBack: 10000,
  },
  "43114": {
    // Avalanche
    oneHour: 1800, // 2 seconds per block
    maxBlockLookBack: 2000,
  },
  other: {
    oneHour: 240, // 15 seconds per block
    maxBlockLookBack: 1000,
  },
};
