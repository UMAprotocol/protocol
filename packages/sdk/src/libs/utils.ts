import assert from "assert";
import { BigNumber } from "ethers";
// check if a value is not null or undefined, useful for numbers which could be 0.
// "is" syntax: https://stackoverflow.com/questions/40081332/what-does-the-is-keyword-do-in-typescript
/* eslint-disable-next-line @typescript-eslint/ban-types */
export function exists(value: any): value is {} {
  return value !== null && value !== undefined;
}

// useful for maintaining balances from events
export type Balances = { [key: string]: string };
export function Balances(balances: Balances) {
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
  function add(id: string, amount: string) {
    balances[id] = BigNumber.from(amount).add(getOrCreate(id)).toString();
    return balances;
  }
  function sub(id: string, amount: string) {
    balances[id] = BigNumber.from(getOrCreate(id)).sub(amount).toString();
    return balances;
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
