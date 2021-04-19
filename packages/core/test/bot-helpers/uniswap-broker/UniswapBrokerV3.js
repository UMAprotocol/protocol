const { MAX_UINT_VAL } = require("@uma/common");
const { toWei, toBN, fromWei } = web3.utils;
const { getTruffleContract } = require("@uma/core");
const truffleContract = require("@truffle/contract");

const bn = require("bignumber.js"); // Big number that comes with web3 does not support square root.

// Tested Contract
// const UniswapBrokerV3 = getTruffleContract("UniswapBroker", web3);
const Token = getTruffleContract("ExpandedERC20", web3);
const WETH9 = getTruffleContract("WETH9", web3);

const SwapRouter = require("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json");
const UniswapV3Factory = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const NonfungibleTokenPositionDescriptor = require("@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json");
const NonfungiblePositionManager = require("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");

let weth;
let factory;
let router;
let positionDescriptor;
let positionManager;

// Takes in a json object from a compiled contract and returns a truffle contract instance that can be deployed.
const createContractObjectFromJson = contractJsonObject => {
  let truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(web3.currentProvider);
  return truffleContractCreator;
};

// TODO: refactor to common util. Taken from https://github.com/Uniswap/uniswap-v3-periphery/blob/main/test/shared/encodePriceSqrt.ts
function encodePriceSqrt(reserve1, reserve0) {
  return new bn(reserve1.toString())
    .div(reserve0.toString())
    .sqrt()
    .multipliedBy(new bn(2).pow(96))
    .integerValue(3);
}

// TODO refactor to common util. taken from https://github.com/Uniswap/uniswap-v3-periphery/blob/main/test/shared/path.ts
function encodePath(path, fees) {
  const FEE_SIZE = 3;
  if (path.length != fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }

  // export const getMaxLiquidityPerTick = tickSpacing =>
  //   BigNumber.from(2)
  //     .pow(128)
  //     .sub(1)
  //     .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1);

  let encoded = "0x";
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2);
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0");
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2);

  return encoded.toLowerCase();
}

function getMinTick(tickSpacing) {
  console.log("tickSpacing", tickSpacing);
  return Math.ceil(-887272 / tickSpacing) * tickSpacing;
}
function getMaxTick(tickSpacing) {
  return Math.floor(887272 / tickSpacing) * tickSpacing;
}

const FeeAmount = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000
};

const TICK_SPACINGS = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200
};

contract("UniswapBrokerV3", function(accounts) {
  const deployer = accounts[0];
  const trader = accounts[1];
  before(async () => {
    weth = await WETH9.new();
    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV3Factory).new({ from: deployer });
    router = await createContractObjectFromJson(SwapRouter).new(factory.address, weth.address, { from: deployer });
    positionDescriptor = await createContractObjectFromJson(NonfungibleTokenPositionDescriptor).new(weth.address, {
      from: deployer
    });
    positionManager = await createContractObjectFromJson(NonfungiblePositionManager).new(
      factory.address,
      weth.address,
      positionDescriptor.address,
      { from: deployer }
    );

    console.log("factory", factory.address);
    console.log("router", router.address);
    console.log("positionDescriptor", positionDescriptor.address);
    console.log("positionManager", positionManager.address);
  });
  beforeEach(async () => {
    // deploy tokens
    tokenA = await Token.new("TokenA", "TA", 18);
    tokenB = await Token.new("TokenB", "TB", 18);

    await tokenA.addMember(1, deployer, { from: deployer });
    await tokenB.addMember(1, deployer, { from: deployer });

    await tokenA.mint(trader, toWei("100000000000000"));
    await tokenB.mint(trader, toWei("100000000000000"));

    await tokenA.approve(positionManager.address, toWei("100000000000000"), { from: trader });
    await tokenB.approve(positionManager.address, toWei("100000000000000"), { from: trader });
    await tokenA.approve(router.address, toWei("100000000000000"), { from: trader });
    await tokenB.approve(router.address, toWei("100000000000000"), { from: trader });

    console.log("encodePriceSqrt(1, 1)", toBN(encodePriceSqrt(1, 1)).toString());
    await positionManager.createAndInitializePoolIfNecessary(
      tokenA.address,
      tokenB.address,
      FeeAmount.MEDIUM,
      encodePriceSqrt(1, 1),
      { from: trader }
    );

    console.log("MIN", getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]));
    const liquidityParams = {
      token0: tokenA.address,
      token1: tokenB.address,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: trader,
      amount0Desired: 1000000,
      amount1Desired: 1000000,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 15798990420
    };
    console.log("liquidityParams", liquidityParams);

    await positionManager.mint(liquidityParams, { from: trader });
  });

  it("simple", async function() {
    const params = {
      path: encodePath(tokens, new Array(tokens.length - 1).fill(FeeAmount.MEDIUM)),
      recipient: trader.address,
      deadline: 15798990420,
      amountIn: 3,
      amountOutMinimum: 1
    };

    await router.exactInput(params, { value }, { from: trader });
  });
});
