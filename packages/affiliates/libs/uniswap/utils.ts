import assert from "assert";
import { ethers, BigNumberish } from "ethers";
import { Position } from "./models";
// taken from uniswap subgraph, not sure if correct yet. this is currently not used and for reference only.
// const Q192 = 2n ** 192n;
// export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt): string[] {
//   const num = BigInt(sqrtPriceX96) ** 2n
//   const denom = Q192;
//   const price1 = BigInt(num) / BigInt(denom);
//   const price0 = 1n / price1;
//   return [price0.toString(), price1.toString()];
// }

// check if a value is not null or undefined, useful for numbers which could be 0.
// "is" syntax: https://stackoverflow.com/questions/40081332/what-does-the-is-keyword-do-in-typescript
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists(value: any): value is {} {
  return value !== null && value !== undefined;
}

// taken from uniswap code:
// https://github.com/Uniswap/uniswap-v3-core/blob/main/test/shared/utilities.ts
export function getPositionKey(address: string, lowerTick: string, upperTick: string): string {
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(["address", "int24", "int24"], [address, lowerTick, upperTick])
  );
}

export function convertValuesToString<T>(obj: { [k: string]: any }): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      return [key, value.toString()];
    })
  ) as T;
}

export function liquidityPerTick(params: { liquidity: string; tickLower: string; tickUpper: string }) {
  const { liquidity, tickLower, tickUpper } = params;
  return (BigInt(liquidity) / (BigInt(tickUpper) - BigInt(tickLower))).toString();
}

// this is stronger than position, but compatible, since these fields have been validated to exist
type ActivePosition = Position & {
  liquidity: BigNumberish;
  tickUpper: BigNumberish;
  tickLower: BigNumberish;
};
export const IsPositionActive = (tick: BigNumberish) => (position: Position): position is ActivePosition => {
  assert(position.liquidity, "requires position liquidity");
  assert(position.tickUpper, "requires position tickUpper");
  assert(position.tickLower, "requires position tickLower");
  if (BigInt(position.liquidity.toString()) === 0n) return false;
  if (BigInt(tick.toString()) > BigInt(position.tickUpper.toString())) return false;
  if (BigInt(tick.toString()) < BigInt(position.tickLower.toString())) return false;
  return true;
};

export function percent(val: string | BigInt, sum: string | BigInt, scale = 10n ** 18n) {
  return (BigInt(val) * scale) / BigInt(sum);
}

export function percentShares(
  contributions: { [key: string]: string } = {},
  sum?: string | BigInt,
  scale: string | BigInt = 10n ** 18n
) {
  const defaultSum =
    BigInt(sum) ||
    Object.values(contributions).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);

  if (defaultSum == 0n) return {};

  return Object.entries(contributions).reduce((result: { [key: string]: string }, [key, value]) => {
    result[key] = percent(value, defaultSum, BigInt(scale)).toString();
    return result;
  }, {});
}
