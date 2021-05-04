// proof of concept script to interface and get state from univ3
require("dotenv").config();
import { ethers, BigNumberish } from "ethers";
import Promise from "bluebird";
import assert from "assert";

import V3CoreFactory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import NFTPositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import { Pools, Positions, Ticks, NftPositions, Position, Tick, NftPosition, Pool } from "../libs/uniswap/models";
import { PoolFactory, PoolEvents, NftEvents } from "../libs/uniswap/processor";
import { convertValuesToString, exists } from "../libs/uniswap/utils";

type NetworkName = "kovan" | "rinkeby" | "ropsten";
const networks = new Map<NetworkName, any>([
  [
    "kovan",
    {
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
      v3MigratorAddress: "0x9dF511178D1438065F7672379414F5C46D5B51b4"
    }
  ],
  [
    "rinkeby",
    {
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
      v3MigratorAddress: "0x03782388516e94FcD4c18666303601A12Aa729Ea"
    }
  ],
  [
    "ropsten",
    {
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
      v3MigratorAddress: "0x1988F2e49A72C4D73961C7f4Bb896819d3d2F6a3"
    }
  ]
]);
const infura = process.env.infura;
const network = "rinkeby";

function getAddress(network: NetworkName, contractName: string) {
  const addresses = networks.get(network);
  assert(addresses[contractName], "invalid contract name: " + contractName);
  return addresses[contractName];
}

async function getPoolState(params: { pool: Pool; provider: any }) {
  const { pool, provider } = params;
  assert(pool.address, "requires pool address");
  const contract = new ethers.Contract(pool.address, UniswapV3Pool.abi, provider);
  const slot0 = await contract.slot0();
  const liquidity = await contract.liquidity();
  return {
    ...slot0,
    liquidity: liquidity.toString()
  };
}
async function processNftEvents(params: { provider: any; positions: ReturnType<typeof NftPositions> }) {
  const { provider, positions } = params;
  const nftHandler = NftEvents({ positions });
  const contract = new ethers.Contract(
    getAddress(network, "nonfungibleTokenPositionManagerAddress"),
    NFTPositionManager.abi,
    provider
  );
  const events = await contract.queryFilter({});
  await Promise.map(events, nftHandler);
}
async function getNftPositionState(params: { provider: any; position: NftPosition }) {
  const { provider, position } = params;
  const contract = new ethers.Contract(
    getAddress(network, "nonfungibleTokenPositionManagerAddress"),
    NFTPositionManager.abi,
    provider
  );
  return convertValuesToString(await contract.positions(position.tokenId));
}
async function processPoolEvents(params: {
  provider: any;
  pool: Pool;
  positions: ReturnType<typeof Positions>;
  pools: ReturnType<typeof Pools>;
}) {
  const { pools, pool, provider, positions } = params;
  assert(pool.id, "requires pool id");
  assert(pool.address, "requires pool address");
  const poolHandler = PoolEvents({ positions, id: pool.id, pools });
  const contract = new ethers.Contract(pool.address, UniswapV3Pool.abi, provider);
  const events = await contract.queryFilter({});
  await Promise.map(events, poolHandler);
}
async function getPositionState(params: { position: Position; provider: any; pool: Pool }) {
  const { position, provider, pool } = params;
  assert(pool.address, "requires pool address");
  const contract = new ethers.Contract(pool.address, UniswapV3Pool.abi, provider);
  return {
    pool: pool.address,
    ...convertValuesToString<Position>(await contract.positions(position.id))
  };
}

const IsPositionActive = (tick: BigNumberish) => (position: Position) => {
  assert(position.liquidity, "requires position liquidity");
  assert(position.tickUpper, "requires position tickUpper");
  assert(position.tickLower, "requires position tickLower");
  if (BigInt(position.liquidity.toString()) === 0n) return false;
  if (BigInt(tick.toString()) > BigInt(position.tickUpper.toString())) return false;
  if (BigInt(tick.toString()) < BigInt(position.tickLower.toString())) return false;
  return true;
};

async function getTickInfo(params: { pool: Pool; provider: any }) {
  const { pool, provider } = params;
  assert(pool.address, "requires pool address");
  const contract = new ethers.Contract(pool.address, UniswapV3Pool.abi, provider);
  return contract.ticks(pool.tick);
}

async function run() {
  const provider = ethers.getDefaultProvider(infura);

  const pools = Pools();
  const positions = Positions();
  const nftPositions = NftPositions();
  const ticks = Ticks();
  const activePositions = Positions();

  // see all pools created
  const factory = new ethers.Contract(getAddress(network, "v3CoreFactoryAddress"), V3CoreFactory.abi, provider);
  // get all factory events
  const events = await factory.queryFilter({});

  // init event handler with pools
  const factoryHandler = PoolFactory({ pools, positions });

  // handle events and update pools
  await Promise.mapSeries(events, factoryHandler);

  // loop through all pools
  await Promise.mapSeries(await pools.list(), async pool => {
    // update pool with latest state
    assert(pool.id, "requires pool id");
    await pools.update(pool.id, await getPoolState({ pool, provider }));
    // handle all pool events to get positions
    await processPoolEvents({ pools, pool, provider, positions });

    // get position state from pools
    await Promise.mapSeries(await positions.list(), async position => {
      assert(position.id, "requires position id");
      return positions.update(position.id, await getPositionState({ position, provider, pool }));
    });

    const updatedPool = await pools.get(pool.id);
    const { address, tick } = updatedPool;
    assert(exists(tick), "requires tick");
    // get tick states
    await ticks.create({ pool: address, index: tick, ...(await getTickInfo({ pool: updatedPool, provider })) });
    // filter active positions only
    await Promise.map(await positions.list(), async position => {
      if (!IsPositionActive(tick)(position)) return;
      await activePositions.create(position);
    });
  });

  // afaik nft contract holds all positions across all pools
  await processNftEvents({ provider, positions: nftPositions });

  await Promise.mapSeries(await nftPositions.list(), async position => {
    assert(position.id, "requires position id");
    return nftPositions.update(position.id, await getNftPositionState({ provider, position }).catch(() => ({})));
  });
  // log everything to spot check all the stat is there
  console.log(await pools.list());
  console.log(await positions.list());
  console.log(await ticks.list());
  console.log(await activePositions.list());
  console.log((await activePositions.list()).length);
  console.log(await nftPositions.list());
}

run()
  .then(console.log)
  .catch(console.log);
