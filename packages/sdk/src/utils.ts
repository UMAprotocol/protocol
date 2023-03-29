import assert from "assert";
import { BigNumber, Contract } from "ethers";
import type Multicall2 from "./multicall2";
import zip from "lodash/zip";

export type BigNumberish = number | string | BigNumber;
// check if a value is not null or undefined, useful for numbers which could be 0.
// "is" syntax: https://stackoverflow.com/questions/40081332/what-does-the-is-keyword-do-in-typescript
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists<T>(value: T | null | undefined): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

// useful for maintaining balances from events
export type Balances = { [key: string]: string };
export function Balances(balances: Balances = {}) {
  function create(id: string, amount = "0") {
    assert(!has(id), "balance already exists");
    return set(id, amount);
  }
  function has(id: string) {
    return exists(balances[id]);
  }
  function set(id: string, amount: string) {
    balances[id] = amount;
    return amount;
  }
  function add(id: string, amount: BigNumberish) {
    return set(id, BigNumber.from(amount).add(getOrCreate(id)).toString());
  }
  function sub(id: string, amount: BigNumberish) {
    return set(id, BigNumber.from(getOrCreate(id)).sub(amount).toString());
  }
  function get(id: string) {
    assert(has(id), "balance does not exist");
    return balances[id];
  }
  function getOrCreate(id: string) {
    if (has(id)) return get(id);
    return create(id);
  }
  return { create, add, sub, get, balances, set, has, getOrCreate };
}

// Copied from common, but modified for ethers Bignumber
export const ConvertDecimals = (fromDecimals: number, toDecimals: number) => {
  assert(fromDecimals >= 0, "requires fromDecimals as an integer >= 0");
  assert(toDecimals >= 0, "requires toDecimals as an integer >= 0");
  // amount: string, BN, number - integer amount in fromDecimals smallest unit that want to convert toDecimals
  // returns: string with toDecimals in smallest unit
  return (amount: BigNumberish): string => {
    assert(exists(amount), "must provide an amount to convert");
    amount = BigNumber.from(amount);
    if (amount.isZero()) return amount.toString();
    const diff = fromDecimals - toDecimals;
    if (diff == 0) return amount.toString();
    if (diff > 0) return amount.div(BigNumber.from("10").pow(diff)).toString();
    return amount.mul(BigNumber.from("10").pow(-1 * diff)).toString();
  };
};

// async sleep
export const sleep = (delay = 0) => new Promise((res) => setTimeout(res, delay));

// Loop forever but wait until execution is finished before starting next timer. Throw an error to break this
// or add another utlity function if you need it to end on condition.
export async function loop(fn: (...args: any[]) => any, delay: number, ...args: any[]) {
  do {
    await fn(...args);
    await sleep(delay);
    /* eslint-disable-next-line no-constant-condition */
  } while (true);
}

export type Call = [string, ...BigNumberish[]];
export type Calls = Call[];
export type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;
export const BatchReadWithErrors = (multicall2: Multicall2) => (contract: Contract) => async <R>(
  calls: Calls
): Promise<R> => {
  // multicall batch takes array of {method} objects
  const results = await multicall2
    .batch(
      contract,
      calls.map(([method, ...args]) => ({ method, args }))
    )
    .readWithErrors();
  // convert results of multicall, an array of responses, into an object keyed by contract method
  return Object.fromEntries(
    zip(calls, results).map(([call, result]) => {
      if (call == null) return [];
      const [method] = call;
      if (!result?.result) return [method, undefined];
      return [method, result.result[0] || result.result];
    })
  );
};

/**
 * @notice Return average block-time for a period.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function averageBlockTimeSeconds(chainId?: number): Promise<number> {
  // TODO: Call an external API to get this data. Currently this value is a hard-coded estimate
  // based on the data from https://etherscan.io/chart/blocktime. ~13.5 seconds has been the average
  // since April 2016, although this value seems to spike periodically for a relatively short period of time.
  const defaultBlockTimeSeconds = 12;
  if (!defaultBlockTimeSeconds) {
    throw "Missing default block time value";
  }

  switch (chainId) {
    // Source: https://polygonscan.com/chart/blocktime
    case 10:
      return 0.5;
    case 42161:
      return 0.5;
    case 288:
      return 150;
    case 137:
      return 2.5;
    case 1:
      return defaultBlockTimeSeconds;
    default:
      return defaultBlockTimeSeconds;
  }
}

export async function estimateBlocksElapsed(
  seconds: number,
  cushionPercentage = 0.0,
  chainId?: number
): Promise<number> {
  const cushionMultiplier = cushionPercentage + 1.0;
  const averageBlockTime = await averageBlockTimeSeconds(chainId);
  return Math.floor((seconds * cushionMultiplier) / averageBlockTime);
}
