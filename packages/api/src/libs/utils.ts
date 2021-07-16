import lodash from "lodash";
import { Obj } from "..";
import * as uma from "@uma/sdk";
import { utils, BigNumber, Contract } from "ethers";
import assert from "assert";
const { parseUnits, parseBytes32String } = utils;

export const SCALING_MULTIPLIER = parseUnits("1");
export type BigNumberish = number | string | BigNumber;

export { parseUnits };

// Takes an object with promises on its values and resolves them concurrently returning result.
// Will pass through non promise values without a problem.
export async function asyncValues<R extends Obj>(object: Obj): Promise<R> {
  const promises = Object.values(object).map(async (value) => {
    if (lodash.isFunction(value)) return value();
    return value;
  });
  const keys = Object.keys(object);
  const values = await Promise.all(promises);
  return Object.fromEntries(lodash.zip(keys, values));
}

// calculate gcr assuming token/collateral decimals are equal
export function calcGcr(
  params: Pick<
    uma.tables.emps.Data,
    "totalTokensOutstanding" | "totalPositionCollateral" | "tokenDecimals" | "collateralDecimals"
  >
) {
  const { totalTokensOutstanding, totalPositionCollateral, tokenDecimals, collateralDecimals } = params;
  assert(uma.utils.exists(totalTokensOutstanding), "requires total tokens outstanding");
  assert(uma.utils.exists(totalPositionCollateral), "requires total position collateral");
  assert(uma.utils.exists(tokenDecimals), "requires tokenDecimals");
  assert(uma.utils.exists(collateralDecimals), "requires collateralDecimals");

  if (BigNumber.from(totalTokensOutstanding).gt(0)) {
    const normalizedTokens = uma.utils.ConvertDecimals(tokenDecimals, 18)(totalTokensOutstanding);
    const normalizedCollateral = uma.utils.ConvertDecimals(collateralDecimals, 18)(totalPositionCollateral);
    // parseUnits basically multiplies this by another 10^18
    return parseUnits(normalizedCollateral).div(normalizedTokens);
  }
  return BigNumber.from(0);
}

export function calcTvl(
  // price needs to be in wei
  price: string,
  emp: Pick<uma.tables.emps.Data, "totalPositionCollateral" | "collateralDecimals">
) {
  const { totalPositionCollateral, collateralDecimals } = emp;
  assert(uma.utils.exists(totalPositionCollateral), "requires total position collateral");
  assert(uma.utils.exists(collateralDecimals), "requires collateralDecimals");
  const normalizedCollateral = uma.utils.ConvertDecimals(collateralDecimals, 18)(totalPositionCollateral);
  return BigNumber.from(price).mul(normalizedCollateral).div(SCALING_MULTIPLIER);
}

export function calcTvm(
  // priced in wei because synthetic prices are returned in wei
  price: string,
  emp: Pick<uma.tables.emps.Data, "totalTokensOutstanding" | "tokenDecimals">
) {
  const { totalTokensOutstanding, tokenDecimals } = emp;
  assert(uma.utils.exists(totalTokensOutstanding), "requires totalTokensOutstanding");
  assert(uma.utils.exists(tokenDecimals), "requires tokenDecimals");
  const normalizedTokens = uma.utils.ConvertDecimals(tokenDecimals, 18)(totalTokensOutstanding);
  return BigNumber.from(price).mul(normalizedTokens).div(SCALING_MULTIPLIER);
}

export function calcSyntheticPrice(syntheticPrice: BigNumberish, collateralPrice: BigNumberish) {
  return BigNumber.from(syntheticPrice).mul(collateralPrice).div(SCALING_MULTIPLIER);
}

export function sToMs(s: number) {
  return s * 1000;
}

export function msToS(ms: number) {
  return Math.floor(ms / 1000);
}

export function nowS(): number {
  return msToS(Date.now());
}

// utility to help convert multicall responses to string, these are some times in nested arrays
export function toString(x: any) {
  if (lodash.isArray(x)) {
    return x[0].toString();
  }
  return x.toString();
}
// utility to help convert multicall responses to number, these are some times in nested arrays
export function toNumber(x: any) {
  if (lodash.isArray(x)) {
    return Number(x[0]);
  }
  return Number(x);
}
// utility to help convert multicall responses of bytes32 to string, these are some times in nested arrays
export function parseBytes(x: any) {
  if (lodash.isArray(x)) {
    return parseBytes32String(x[0]);
  }
  return parseBytes32String(x);
}

export const BatchRead = (multicall: uma.Multicall) => async (
  calls: [string, (x: any) => any][],
  contract: Contract
) => {
  // multicall batch takes array of {method} objects
  const results = await multicall
    .batch(
      contract,
      calls.map(([method]) => ({ method }))
    )
    .read();

  // convert results of multicall, an array of responses, into a key value, keyed by contract method
  return Object.fromEntries(
    lodash.zip(calls, results).map((zipped) => {
      const [method, result] = zipped;
      if (method == null) return [];
      if (result == null) return [];
      const [key, map] = method;
      return [key, map(result)];
    })
  );
};

export const Profile = (enabled: boolean | undefined) => {
  return (msg: string) => {
    // if not enabled, dont do anything
    if (!enabled) return lodash.noop;

    const id = lodash.uniqueId(msg + "_");
    console.log(msg);
    console.time(id);
    return () => console.timeEnd(id);
  };
};
