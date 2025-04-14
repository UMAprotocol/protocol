const supportedNetworks = ["mainnet", "polygon", "arbitrum", "optimism", "base", "blast"] as const;
export type SupportedNetwork = typeof supportedNetworks[number];

export const networksNumber: Record<SupportedNetwork, number> = {
  mainnet: 1,
  polygon: 137,
  optimism: 10,
  arbitrum: 42161,
  base: 8453,
  blast: 81457,
};

export const l2Networks = supportedNetworks.filter((network) => network !== "mainnet");
export type L2Network = typeof l2Networks[number];

export const rollupNetworks = supportedNetworks.filter((network) => network !== "mainnet" && network !== "polygon");
export type RollupNetwork = typeof rollupNetworks[number];

export const ovmNetworks = ["optimism", "base", "blast"] as const;
export type OVMNetwork = typeof ovmNetworks[number];
