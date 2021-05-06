import assert from "assert";
import { ethers, BigNumberish } from "ethers";
import { Position } from "./models";

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

// This looks at a positions liquidity, and calculates the amount across a single tick based on full tick span
export function liquidityPerTick(params: { liquidity: string; tickLower: string; tickUpper: string }) {
  const { liquidity, tickLower, tickUpper } = params;
  assert(BigInt(tickUpper) > BigInt(tickLower), "Upper tick must be > lower tick");
  return (BigInt(liquidity) / (BigInt(tickUpper) - BigInt(tickLower))).toString();
}

// this is stronger than position, but compatible, since these fields have been validated to exist
type ActivePosition = Position & {
  liquidity: BigNumberish;
  tickUpper: BigNumberish;
  tickLower: BigNumberish;
};

// figure out if a position is active by looking a liquidity and combination of current tick and position bounds
// this assume the upper tick is not inclusive, meaning if the upper tick matches the current tick, its not active
export const IsPositionActive = (tick: BigNumberish) => (
  position: Pick<Position, "liquidity" | "tickUpper" | "tickLower">
): position is ActivePosition => {
  assert(position.liquidity, "requires position liquidity");
  assert(position.tickUpper, "requires position tickUpper");
  assert(position.tickLower, "requires position tickLower");
  if (BigInt(position.liquidity.toString()) === 0n) return false;
  if (BigInt(tick.toString()) >= BigInt(position.tickUpper.toString())) return false;
  if (BigInt(tick.toString()) < BigInt(position.tickLower.toString())) return false;
  if (BigInt(position.tickUpper) <= BigInt(position.tickLower)) return false;
  return true;
};

// percent: numerator, denominator and scale factor
export function percent(val: string | BigInt, sum: string | BigInt, scale: string | BigInt = 10n ** 18n) {
  return (BigInt(val) * BigInt(scale)) / BigInt(sum);
}

export function percentShares(
  contributions: { [key: string]: string } = {},
  sum?: string | BigInt,
  scale: string | BigInt = 10n ** 18n
) {
  const defaultSum = BigInt(
    sum ||
      Object.values(contributions).reduce((sum, val) => {
        return sum + BigInt(val);
      }, 0n)
  );

  if (defaultSum == 0n) return {};

  return Object.entries(contributions).reduce((result: { [key: string]: string }, [key, value]) => {
    result[key] = percent(value, defaultSum, BigInt(scale)).toString();
    return result;
  }, {});
}
