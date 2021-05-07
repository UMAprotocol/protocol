import assert from "assert";
import { ethers } from "ethers";
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
