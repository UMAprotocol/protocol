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
    nativeToken: string;
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
    nativeToken: "ETH",
    etherscan: "https://etherscan.io/",
    daiAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  3: {
    name: "ropsten",
    nativeToken: "ETH",
    ethFaucet: "https://faucet.metamask.io/",
    etherscan: "https://ropsten.etherscan.io/",
    daiAddress: "0xB5E5D0F8C0cbA267CD3D7035d6AdC8eBA7Df7Cdd",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  4: {
    name: "rinkeby",
    nativeToken: "ETH",
    ethFaucet: "https://faucet.rinkeby.io/",
    etherscan: "https://rinkeby.etherscan.io/",
    daiAddress: "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
  },
  5: { name: "goerli", nativeToken: "ETH", etherscan: "https://goerli.etherscan.io/" },
  10: { name: "optimism", nativeToken: "ETH", etherscan: "https://optimistic.etherscan.io/" },
  42: {
    name: "kovan",
    nativeToken: "ETH",
    ethFaucet: "https://faucet.kovan.network/",
    etherscan: "https://kovan.etherscan.io/",
    daiAddress: "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99",
    wethAddress: "0xd0A1E359811322d97991E03f863a0C30C2cF029C",
  },
  69: { name: "optimism-kovan", nativeToken: "ETH", etherscan: "https://kovan-optimistic.etherscan.io/" },
  82: { name: "meter", nativeToken: "MTR", etherscan: "https://scan.meter.io/" },
  100: { name: "xdai", nativeToken: "XDAI", etherscan: "https://blockscout.com/xdai/mainnet" },
  137: {
    name: "polygon-matic",
    nativeToken: "MATIC",
    etherscan: "https://polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  280: { name: "zksync-goerli", nativeToken: "ETH", etherscan: "https://goerli.explorer.zksync.io/" },
  288: { name: "boba", nativeToken: "ETH", etherscan: "https://blockexplorer.boba.network/" },
  324: { name: "zksync", nativeToken: "ETH", etherscan: "https://explorer.zksync.io/" },
  416: { name: "sx", nativeToken: "SX", etherscan: "https://explorer.sx.technology/" },
  1115: { name: "core-testnet", nativeToken: "tCORE", etherscan: "https://scan.test.btcs.network/" },
  1116: { name: "core", nativeToken: "CORE", etherscan: "https://scan.coredao.org/" },
  1513: { name: "illiad", nativeToken: "IP", etherscan: "https://testnet.storyscan.xyz/" },
  1516: { name: "odyssey", nativeToken: "IP", etherscan: "https://odyssey-testnet-explorer.storyscan.xyz" },
  9001: { name: "evmos", nativeToken: "EVMOS", etherscan: "https://evm.evmos.org" },
  80001: {
    name: "polygon-mumbai",
    nativeToken: "MATIC",
    etherscan: "https://mumbai.polygonscan.com/",
    customTruffleConfig: { confirmations: 2, timeoutBlocks: 200 },
  },
  80002: {
    name: "polygon-amoy",
    nativeToken: "MATIC",
    etherscan: "https://amoy.polygonscan.com/",
  },
  42161: { name: "arbitrum", nativeToken: "ETH", etherscan: "https://arbiscan.io/" },
  43114: { name: "avalanche", nativeToken: "AVAX", etherscan: "https://snowtrace.io/" },
  8453: { name: "base", nativeToken: "ETH", etherscan: "https://basescan.org/" },
  81457: { name: "blast", nativeToken: "ETH", etherscan: "https://blastscan.io/" },
  84531: { name: "base-goerli", nativeToken: "ETH", etherscan: "https://goerli.basescan.org/" },
  421611: { name: "arbitrum-rinkeby", nativeToken: "ETH", etherscan: "https://testnet.arbiscan.io/" },
  421613: { name: "arbitrum-goerli", nativeToken: "ETH", etherscan: "https://goerli.arbiscan.io/" },
  421614: { name: "arbitrum-sepolia", nativeToken: "ETH", etherscan: "https://sepolia.arbiscan.io/" },
  11155111: { name: "sepolia", nativeToken: "ETH", etherscan: "https://sepolia.etherscan.io/" },
  168587773: { name: "blast-sepolia", nativeToken: "ETH", etherscan: "https://testnet.blastscan.io" },
};

export function isPublicNetwork(name: string): boolean {
  return Object.values(PublicNetworks).some((network) => name.startsWith(network.name));
}
