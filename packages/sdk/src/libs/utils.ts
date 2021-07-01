import assert from "assert";
import { BigNumber } from "ethers";

export type BigNumberish = number | string | BigNumber;
// check if a value is not null or undefined, useful for numbers which could be 0.
// "is" syntax: https://stackoverflow.com/questions/40081332/what-does-the-is-keyword-do-in-typescript
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists(value: any): value is {} {
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
