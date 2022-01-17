import lodash from "lodash";
import { Obj } from "../types";
import * as uma from "@uma/sdk";
import { utils, BigNumber, Contract, ethers } from "ethers";
import assert from "assert";
import Web3 from "web3";
const { parseUnits, parseBytes32String } = utils;

export const SCALING_MULTIPLIER: BigNumber = parseUnits("1");
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
): BigNumber {
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

export const BatchRead = (multicall: uma.Multicall2) => async (
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

export const BatchReadWithErrors = (multicall2: uma.Multicall2) => async (
  calls: [string, (x: any) => any][],
  contract: Contract
) => {
  // multicall batch takes array of {method} objects
  const results = await multicall2
    .batch(
      contract,
      calls.map(([method]) => ({ method }))
    )
    .readWithErrors();
  // convert results of multicall, an array of responses, into an object keyed by contract method
  return Object.fromEntries(
    lodash.zip(calls, results).map(([call, result]) => {
      if (call == null) return [];
      const [method, cb] = call;
      if (!result?.result) return [method, undefined];
      return [method, cb(result.result)];
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

// defines a standard convention to pass arrays through an env.  assumes each element in the string is delimited by a comma
export function parseEnvArray(str: string, delimiter = ","): string[] {
  if (str.length == 0) return [];
  if (!str.includes(delimiter)) return [];
  return str.split(delimiter).map((x) => x.trim());
}

export function getWeb3Websocket(url: string, options: Obj = {}) {
  // pulled from common/src/ProviderUtils.ts
  const defaults = {
    clientConfig: {
      maxReceivedFrameSize: 100000000, // Useful if requests result are large bytes - default: 1MiB
      maxReceivedMessageSize: 100000000, // bytes - default: 8MiB
    },
    reconnect: {
      auto: true, // Enable auto reconnection
      delay: 5000, // ms
      maxAttempts: 10,
      onTimeout: false,
    },
  };
  return new Web3(
    new Web3.providers.WebsocketProvider(url, {
      ...options,
      ...defaults,
    })
  );
}

export function getWeb3Http(url: string) {
  return new Web3(new Web3.providers.HttpProvider(url));
}

export function getWeb3(url: string, options: Obj = {}) {
  if (url.startsWith("ws")) return getWeb3Websocket(url, options);
  if (url.startsWith("http")) return getWeb3Http(url);

  throw new Error("Web3 provider URLs not supported");
}

export function getEthers(url: string) {
  if (url.startsWith("ws")) return new ethers.providers.WebSocketProvider(url);
  if (url.startsWith("http")) return new ethers.providers.JsonRpcProvider(url);

  throw new Error("Unsupported ethers provider url");
}

// this just maintains the start/endblock given sporadic updates with a latest block number
export function BlockInterval(update: (startBlock: number, endBlock: number) => Promise<void>, startBlock = 0) {
  return async (endBlock: number) => {
    const params = {
      startBlock,
      endBlock,
    };
    await update(startBlock, endBlock);
    startBlock = endBlock;
    return params;
  };
}

// rejects after a timeout period
export function rejectAfterDelay(ms: number, message = "Call timed out") {
  let timeout: NodeJS.Timeout;

  const cancel = () => {
    clearInterval(timeout);
  };
  const promise = new Promise<void>((res, rej) => {
    timeout = setTimeout(() => {
      clearTimeout(timeout);
      rej(message);
    }, ms);
  });

  return [promise, cancel] as [Promise<void>, () => void];
}

// races a promise against a timeout to reject if it takes too long
export async function expirePromise(promise: () => Promise<any>, timeoutms: number, errorMessage?: string) {
  const [rejectPromise, cancel] = rejectAfterDelay(timeoutms, errorMessage);
  return Promise.race([promise(), rejectPromise]).finally(cancel);
}

/**
 * Takes two values and returns a list of number intervals
 *
 * @example
 * ```js
 * getSamplesBetween(1, 10, 3) //returns [[1, 4], [5, 8], [9, 10]]
 * ```
 */
export function getSamplesBetween(min: number, max: number, size: number) {
  let keepIterate = true;
  const intervals = [];

  while (keepIterate) {
    const to = Math.min(min + size, max);
    intervals.push([min, to]);
    min = to + 1;
    if (min >= max) keepIterate = false;
  }

  return intervals;
}
