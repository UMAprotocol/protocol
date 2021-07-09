import * as uma from "@uma/sdk";
import Promise from "bluebird";
const { emp } = uma.clients;
import { utils } from "ethers";
const { parseBytes32String } = utils;
import { AppState } from "..";
import lodash from "lodash";

type Instance = uma.clients.emp.Instance;
type Config = undefined;
type Dependencies = Pick<
  AppState,
  "registeredEmps" | "provider" | "emps" | "collateralAddresses" | "syntheticAddresses" | "multicall"
>;

// utility to help convert multicall responses to string
function toString(x: any) {
  if (lodash.isArray(x)) {
    return x[0].toString();
  }
  return x.toString();
}
// utility to help convert multicall responses to number
function toNumber(x: any) {
  if (lodash.isArray(x)) {
    return Number(x[0]);
  }
  return Number(x);
}
// utility to help convert multicall responses of bytes32 to string
function parseBytes(x: any) {
  if (lodash.isArray(x)) {
    return parseBytes32String(x[0]);
  }
  return parseBytes32String(x);
}
export default (config: Config, appState: Dependencies) => {
  const { registeredEmps, provider, emps, collateralAddresses, syntheticAddresses, multicall } = appState;

  // wrapper around multicall batched read to call contract methods and format responses
  async function batchRead(calls: [string, (x: any) => any][], instance: Instance) {
    // multical batch takes array of {method} objects
    const results = await multicall
      .batch(
        instance,
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
  }

  // defines what we are calling dynamic state, which can change in the emp from block to block
  async function readEmpDynamicState(instance: Instance, address: string) {
    const calls: [string, (x: any) => any][] = [
      ["totalTokensOutstanding", toString],
      // for some reason this call returns an array of values, something to do with this being a function
      ["totalPositionCollateral", toString],
      ["rawTotalPositionCollateral", toString],
      ["expiryPrice", toString],
    ];
    const result = await batchRead(calls, instance);

    return {
      address,
      updated: Date.now(),
      ...result,
    };
  }

  // queries all static state, ie state which does not change in the emp once set
  async function readEmpStaticState(instance: Instance, address: string) {
    const calls: [string, (x: any) => any][] = [
      ["priceIdentifier", parseBytes],
      ["expirationTimestamp", toString],
      ["withdrawalLiveness", toString],
      ["tokenCurrency", toString],
      ["collateralCurrency", toString],
      ["finder", toString],
      ["minSponsorTokens", toString],
      ["liquidationLiveness", toNumber],
      ["collateralRequirement", toString],
      ["disputeBondPercentage", toString],
      ["sponsorDisputeRewardPercentage", toString],
      ["disputerDisputeRewardPercentage", toString],
      ["cumulativeFeeMultiplier", toString],
    ];
    const result = await batchRead(calls, instance);

    return {
      address,
      updated: Date.now(),
      ...result,
    };
  }

  async function updateOne(address: string, startBlock?: number | "latest", endBlock?: number) {
    // ignore expired emps
    if (await emps.expired.has(address)) return;

    const instance: Instance = emp.connect(address, provider);
    let currentState: uma.tables.emps.Data = { address };
    let staticState: uma.tables.emps.Data = { address };
    let dynamicState: uma.tables.emps.Data = { address };
    let eventState: uma.clients.emp.EventState = { sponsors: [] };

    // query all events
    const events = await instance.queryFilter({}, startBlock, endBlock);
    // returns all sponsors ( this should really be a seperate table eventually)
    eventState = await emp.getEventState(events);
    dynamicState = await readEmpDynamicState(instance, address);

    // this is really complex logic which i dont know how to simplify. It optimizes queries so that
    // static data is only read once per emp, and emps move between tables from active to expired.
    // emp expired, must handle this
    if (eventState.expired) {
      // see if it used to be active
      if (await emps.active.has(address)) {
        // get state
        currentState = await emps.active.get(address);
        // add it to expired emps
        await emps.expired.create({
          ...currentState,
          ...staticState,
          ...dynamicState,
          sponsors: eventState.sponsors,
          expired: true,
        });
        // delete it from active
        await emps.active.delete(address);
      } else {
        // have to make sure we get static state if we have never seen this expired emp before
        staticState = await readEmpStaticState(instance, address);
        // if it was never active, just create an expired emp
        await emps.expired.create({ ...staticState, ...dynamicState, sponsors: eventState.sponsors, expired: true });
      }
      // handle the case wehre emp is not yet expired
    } else {
      // if it doesnt exist we need to create it
      if (!(await emps.active.has(address))) {
        // get static state once if it does not exist (optimizes network calls)
        staticState = await readEmpStaticState(instance, address);
        // create active emp with static/dynamic state
        await emps.active.create({ ...staticState, ...dynamicState });
      }
      // add any new sponsors
      await emps.active.addSponsors(address, eventState.sponsors || []);
    }
  }

  // add a set of all collateral addresses
  async function updateTokenAddresses() {
    const allEmps = [...(await emps.active.values()), ...(await emps.expired.values())];
    allEmps.forEach((emp) => {
      if (emp.collateralCurrency) collateralAddresses.add(emp.collateralCurrency);
      if (emp.tokenCurrency) syntheticAddresses.add(emp.tokenCurrency);
    });
  }

  async function update(startBlock?: number | "latest", endBlock?: number) {
    const addresses = Array.from(await registeredEmps.values());
    await Promise.mapSeries(addresses, async (address: string) => {
      try {
        await updateOne(address, startBlock, endBlock);
        delete emps.errored[address];
      } catch (err) {
        emps.errored[address] = err;
      }
    });
    await updateTokenAddresses();
  }

  return {
    update,
    utils: {
      updateTokenAddresses,
      readEmpDynamicState,
      readEmpStaticState,
    },
  };
};
