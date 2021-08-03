// This file contains a number of useful uniswap v3 helpers helper functions.

import Web3 from "web3";
import { BN } from "./types";
import { ethers } from "ethers";
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import Decimal from "decimal.js";
import bn from "bignumber.js"; // Big number that comes with web3 does not support square root.
import { createContractObjectFromJson } from "./ContractUtils";

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const { toBN, toWei } = Web3.utils;

// Given a price defined in a ratio of reserve1 and reserve0 in x96, compute a price as sqrt(r1/r0) * 2^96
export function encodePriceSqrt<T extends { toString: () => string }, U extends { toString: () => string }>(
  reserve1: T,
  reserve0: U
): bn {
  return new bn(reserve1.toString()).div(reserve0.toString()).sqrt().multipliedBy(new bn(2).pow(96)).integerValue(3);
}

// reverse x96 operation by compting (price/(2^96))^2
export function decodePriceSqrt(priseSqrt: string): bn {
  return new bn(priseSqrt).dividedBy(new bn(2).pow(96)).pow(2);
}

// Fetch the decoded price from a uniswap pool from slot0.
export async function getCurrentPrice(poolAddress: string, web3: Web3): Promise<bn> {
  const pool = await createContractObjectFromJson(UniswapV3Pool, web3).at(poolAddress);

  const slot0 = await pool.slot0();

  return decodePriceSqrt(slot0.sqrtPriceX96);
}

// Encode a path. Note that pools (and therefore paths) change when you use different fees.
export function encodePath(path: string[], fees: BN[] | string[] | number[]): string {
  const FEE_SIZE = 3;
  if (path.length != fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }

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

export function toBNWei(input: BN | string | number): BN {
  return toBN(toWei(input.toString()));
}

export type FeeAmount = keyof typeof TICK_SPACINGS;

// The price in a pool, in terms of tick number, can be expressed as: p=1.0001^tick (taken from uniswapV3 white paper).
// Solving for the tick in terms of the price yields tick≈1.00005*ln(p) (calculated on wolframalpha). When creating a
// position, the tick needs to be a multiple of the TICK_SPACING for that particular fee. This method therefore computes
// a valid tick for a given price and poolFee.
export function getTickFromPrice(price: BN | string | number, poolFee: FeeAmount): string {
  return toBNWei(10000.5)
    .mul(toBNWei(new Decimal(price.toString()).ln().toFixed(10)))
    .div(toBNWei(1))
    .divn(TICK_SPACINGS[poolFee])
    .div(toBNWei(1))
    .muln(TICK_SPACINGS[poolFee])
    .toString();
}

export function getMinTick(tickSpacing: number): number {
  return Math.ceil(-887272 / tickSpacing) * tickSpacing;
}
export function getMaxTick(tickSpacing: number): number {
  return Math.floor(887272 / tickSpacing) * tickSpacing;
}

export function getTickBitmapIndex(tick: number | BN | string, tickSpacing: number): BN {
  const intermediate = toBN(tick.toString()).div(toBN(tickSpacing.toString()));

  // see https://docs.soliditylang.org/en/v0.7.6/types.html#shifts

  if (intermediate.lt(toBN("0")))
    return intermediate
      .addn(1)
      .div(toBN("2").pow(toBN("8")))
      .subn(1);
  else return intermediate.shrn(8);
}

export function computePoolAddress(factoryAddress: string, tokenA: string, tokenB: string, fee: FeeAmount): string {
  const POOL_BYTECODE_HASH = ethers.utils.keccak256(UniswapV3Pool.bytecode);
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const constructorArgumentsEncoded = ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "uint24"],
    [token0, token1, fee]
  );
  const create2Inputs = [
    "0xff",
    factoryAddress,
    // salt
    ethers.utils.keccak256(constructorArgumentsEncoded),
    // init code hash
    POOL_BYTECODE_HASH,
  ];
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join("")}`;
  return ethers.utils.getAddress(`0x${ethers.utils.keccak256(sanitizedInputs).slice(-40)}`);
}

export const FeeAmount = { LOW: 500, MEDIUM: 3000, HIGH: 10000 };

export const TICK_SPACINGS = { [FeeAmount.LOW]: 10, [FeeAmount.MEDIUM]: 60, [FeeAmount.HIGH]: 200 };
