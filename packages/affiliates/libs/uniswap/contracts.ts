import assert from "assert";
import { ethers } from "ethers";
import Promise from "bluebird";

import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";

import { Positions, Position, Pool } from "./models";
import { PoolEvents } from "./processor";
import { convertValuesToString } from "./utils";

type NetworkName = "kovan" | "rinkeby" | "ropsten";
type ContractType =
  | "v3CoreFactoryAddress"
  | "weth9Address"
  | "multicall2Address"
  | "proxyAdminAddress"
  | "tickLensAddress"
  | "quoterAddress"
  | "swapRouter"
  | "nonfungibleTokenPositionDescriptorAddress"
  | "descriptorProxyAddress"
  | "nonfungibleTokenPositionManagerAddress"
  | "v3MigratorAddress";

type Networks = {
  readonly [key in NetworkName]: {
    readonly [key in ContractType]: string;
  };
};

// Maybe this is available somewhere in uniswaps module, but not sure
const networks: Networks = {
  kovan: {
    v3CoreFactoryAddress: "0x7046f9311663DB8B7cf218BC7B6F3f17B0Ea1047",
    weth9Address: "0xd0A1E359811322d97991E03f863a0C30C2cF029C",
    multicall2Address: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
    proxyAdminAddress: "0x8dF824f7885611c587AA45924BF23153EC832b89",
    tickLensAddress: "0x3b1aC1c352F3A18A58471908982b8b870c836EC0",
    quoterAddress: "0x539BF58f052dE91ae369dAd59f1ac6887dF39Bc5",
    swapRouter: "0xbBca0fFBFE60F60071630A8c80bb6253dC9D6023",
    nonfungibleTokenPositionDescriptorAddress: "0xc4b81504F9a2bd6a6f2617091FB01Efb38D119c8",
    descriptorProxyAddress: "0xDbe2c61E85D06eaA6E7916049f38B93288BA30f3",
    nonfungibleTokenPositionManagerAddress: "0xd3808aBF85aC69D2DBf53794DEa08e75222Ad9a1",
    v3MigratorAddress: "0x9dF511178D1438065F7672379414F5C46D5B51b4",
  },
  rinkeby: {
    v3CoreFactoryAddress: "0xFeabCc62240297F1e4b238937D68e7516f0918D7",
    weth9Address: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
    multicall2Address: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
    proxyAdminAddress: "0x80AacDBEe92DC1c2Fbaa261Fb369696AF1AD9f98",
    tickLensAddress: "0x3d137e860008BaF6d1c063158e5ec0baBbcFefF8",
    quoterAddress: "0x91a64CCaead471caFF912314E466D9CF7C55E0E8",
    swapRouter: "0x273Edaa13C845F605b5886Dd66C89AB497A6B17b",
    nonfungibleTokenPositionDescriptorAddress: "0x0Fb45B7E5e306fdE29602dE0a0FA2bE088d04899",
    descriptorProxyAddress: "0xd6852c52B9c97cBfb7e79B6ab4407AA20Ba31439",
    nonfungibleTokenPositionManagerAddress: "0x2F9e608FD881861B8916257B76613Cb22EE0652c",
    v3MigratorAddress: "0x03782388516e94FcD4c18666303601A12Aa729Ea",
  },
  ropsten: {
    v3CoreFactoryAddress: "0xDbe2c61E85D06eaA6E7916049f38B93288BA30f3",
    weth9Address: "0xc778417E063141139Fce010982780140Aa0cD5Ab",
    multicall2Address: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
    proxyAdminAddress: "0xd3808aBF85aC69D2DBf53794DEa08e75222Ad9a1",
    tickLensAddress: "0x9dF511178D1438065F7672379414F5C46D5B51b4",
    quoterAddress: "0x2051F6Fb61077b5A2A2c17535d31A1F2C858994f",
    swapRouter: "0x58f6b77148BE49BF7898472268ae8f26377d0AA6",
    nonfungibleTokenPositionDescriptorAddress: "0xeb86f5BE368c3C5e562f7eA1470ACC431d30fB0C",
    descriptorProxyAddress: "0xB79bDE60fc227217f4EE2102dC93fa1264E33DaB",
    nonfungibleTokenPositionManagerAddress: "0x865F20efC14A5186bF985aD42c64f5e71C055376",
    v3MigratorAddress: "0x1988F2e49A72C4D73961C7f4Bb896819d3d2F6a3",
  },
};

export function getAddress(network: NetworkName, contractName: ContractType) {
  return networks[network][contractName];
}

export type BlockNumber = number | "latest";
// Wraps some functionality to get state from a single pool, gets pool global state, individual positions
// and basic state reconstruction from events.
export function PoolClient(provider: ethers.providers.Provider) {
  const abi = UniswapV3Pool.abi;
  // gets the slot0 and liquidity from pool at a block number ( assuming archive node)
  async function getPoolState(params: { blockNumber: BlockNumber; address: string }) {
    const { blockNumber, address } = params;
    const contract = new ethers.Contract(address, abi, provider);
    const slot0 = await contract.slot0({ blockTag: blockNumber });
    const liquidity = await contract.liquidity({ blockTag: blockNumber });
    return {
      ...slot0,
      address,
      liquidity: liquidity.toString(),
    };
  }

  // gets state of position at a block number.
  async function getPositionState(params: { position: Position; blockNumber: BlockNumber; address: string }) {
    const { position, blockNumber, address } = params;
    const contract = new ethers.Contract(address, abi, provider);
    return {
      pool: address,
      ...convertValuesToString<Position>(await contract.positions(position.id, { blockTag: blockNumber })),
    };
  }

  // update pool state and positions table based on events from the pool. mostly just care about positions.
  async function processEvents(params: { pool: Pool; positions: Positions }) {
    const { pool, positions } = params;
    const poolHandler = PoolEvents({ positions });
    const contract = new ethers.Contract(pool.address, UniswapV3Pool.abi, provider);
    const events = await contract.queryFilter({});
    await Promise.map(events, poolHandler);
  }

  return {
    getPoolState,
    getPositionState,
    processEvents,
  };
}
export type PoolClient = ReturnType<typeof PoolClient>;
