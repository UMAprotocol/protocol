import type Web3 from "web3";

// Find the first block at or after the cutoff using chain timestamps, independent of average block speed.
export async function earliestBlockForLookback(
  web3: Web3,
  latest: { number: number; timestamp: number | string },
  lookbackSeconds: number
): Promise<number> {
  if (!Number.isFinite(lookbackSeconds) || lookbackSeconds < 0) throw new Error("Invalid lookback seconds");
  const cutoff = Number(latest.timestamp) - lookbackSeconds;
  let low = 0;
  let high = latest.number;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = await web3.eth.getBlock(middle);
    if (Number(block.timestamp) < cutoff) low = middle + 1;
    else high = middle;
  }
  return low;
}
