// taken from uniswap subgraph, not sure if correct yet
const Q192: BigInt = 2n ** 192n;
export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt): string[] {
  const num = BigInt(sqrtPriceX96) * BigInt(sqrtPriceX96);
  const denom = Q192;
  const price1 = BigInt(num) / BigInt(denom);
  const price0 = 1n / price1;
  return [price0.toString(), price1.toString()];
}

// check if a value is not null or undefined, useful for numbers which could be 0
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists(value: any): value is {} {
  return value !== null && value !== undefined;
}
