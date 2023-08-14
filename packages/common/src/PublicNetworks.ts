// Note: `BRIDGE_CHAIN_ID` is the `chainID` used in Bridge contract enabling cross-EVM communication. The Bridge contract
// stores chainId as a uint8, whose max value is 2^8-1=255. By default, the chainId will simply return the same
// ID as the network (i.e. Rinkeby will return 4 as the chainId), but some networks with chainID's > 255 need to
// override the default behavior because their network ID is too high.
const BRIDGE_CHAIN_ID = { 1337: 253, 80001: 254, 31337: 255 };

type ModifiedBridgeId = keyof typeof BRIDGE_CHAIN_ID;

function isModifedChainId(netId: number): netId is ModifiedBridgeId {
  return netId in BRIDGE_CHAIN_ID;
}

export const getBridgeChainId = (netId: number): number => {
  return isModifedChainId(netId) ? BRIDGE_CHAIN_ID[netId] : netId;
};

interface PublicNetworksType {
  [networkId: number]: {
    name: string;
    ethFaucet?: null | string;
    etherscan: string;
    daiAddress?: string;
    wethAddress?: string;
    customTruffleConfig?: {
      confirmations: number;
      timeoutBlocks: number;
    };
  };
}

export const PublicNetworks: PublicNetworksType = {
  1: {
    name: "mainnet",
    etherscan: "https://etherscan.io/",
    daiAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  3: {
    name: "ropsten",
    ethFaucet: "https://faucet.metamask.io/",
    etherscan: "https://ropsten.etherscan.io/",
    daiAddress: "0xB5E5D0F8C0cbA267CD3D7035d6AdC8eBA7Df7Cdd",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  4: {
    name: "rinkeby",
    ethFaucet: "https://faucet.rinkeby.io/",
    etherscan: "https://rinkeby.etherscan.io/",
    daiAddress: "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  5: { name: "goerli", etherscan: "https://goerli.etherscan.io/" },
  10: { name: "optimism", etherscan: "https://optimistic.etherscan.io/" },
  42: {
    name: "kovan",
    ethFaucet: "https://faucet.kovan.network/",
    etherscan: "https://kovan.etherscan.io/",
    daiAddress: "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99",
    wethAddress: "0xd0A1E359811322d97991E03f863a0C30C2cF029C",
  },
  69: { name: "optimism-kovan", etherscan: "https://kovan-optimistic.etherscan.io/" },
  82: { name: "meter", etherscan: "https://scan.meter.io/" },
  100: { name: "xdai", etherscan: "https://blockscout.com/xdai/mainnet" },
  137: {
    name: "polygon-matic",
    etherscan: "https://polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  280: { name: "zksync-goerli", etherscan: "https://goerli.explorer.zksync.io/" },
  288: { name: "boba", etherscan: "https://blockexplorer.boba.network/" },
  324: { name: "zksync", etherscan: "https://explorer.zksync.io/" },
  416: { name: "sx", etherscan: "https://explorer.sx.technology/" },
  9001: { name: "evmos", etherscan: "https://evm.evmos.org" },
  80001: {
    name: "polygon-mumbai",
    etherscan: "https://mumbai.polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  42161: { name: "arbitrum", etherscan: "https://arbiscan.io/" },
  43114: { name: "avalanche", etherscan: "https://snowtrace.io/" },
  8453: { name: "base", etherscan: "https://basescan.org/" },
  84531: { name: "base-goerli", etherscan: "https://goerli.basescan.org/" },
  421611: { name: "arbitrum-rinkeby", etherscan: "https://testnet.arbiscan.io/" },
  421613: { name: "arbitrum-goerli", etherscan: "https://goerli.arbiscan.io/" },
  11155111: { name: "sepolia", etherscan: "https://sepolia.etherscan.io/" },
};

export function isPublicNetwork(name: string): boolean {
  return Object.values(PublicNetworks).some((network) => name.startsWith(network.name));
}
