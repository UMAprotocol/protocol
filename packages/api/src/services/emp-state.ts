import * as uma from "@uma/sdk";
import Promise from "bluebird";
const { emp } = uma.clients;
import { BigNumber, utils } from "ethers";
const { parseBytes32String } = utils;
import { asyncValues } from "../libs/utils";
import { Json, AppState } from "..";

type Instance = uma.clients.emp.Instance;
export default (config: Json, appState: AppState) => {
  const { registeredEmps, provider, emps, collateralAddresses, syntheticAddresses } = appState;

  async function readEmpDynamicState(instance: Instance, address: string) {
    return asyncValues<uma.tables.emps.Data>({
      address,
      updated: Date.now(),
      totalTokensOutstanding: instance
        .totalTokensOutstanding()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      totalPositionCollateral: instance
        .totalPositionCollateral()
        .then((x) => x.rawValue.toString())
        .catch(() => null),
      rawTotalPositionCollateral: instance
        .rawTotalPositionCollateral()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      expiryPrice: instance
        .expiryPrice()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
    });
  }

  async function readEmpStaticState(instance: Instance, address: string) {
    const state = await asyncValues<uma.tables.emps.Data>({
      address,
      // position manager
      priceIdentifier: instance
        .priceIdentifier()
        .then(parseBytes32String)
        .catch(() => null),
      expirationTimestamp: instance
        .expirationTimestamp()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      withdrawLiveness: instance
        .withdrawalLiveness()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      tokenCurrency: instance.tokenCurrency().catch(() => null),
      collateralCurrency: instance.collateralCurrency().catch(() => null),
      finder: instance.finder().catch(() => null),
      minSponsorTokens: instance
        .minSponsorTokens()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      // liquidatable
      liquidationLiveness: instance
        .liquidationLiveness()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      collateralRequirement: instance
        .collateralRequirement()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      disputeBondPercentage: instance
        .disputeBondPercentage()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      sponsorDisputeRewardPercentage: instance
        .sponsorDisputeRewardPercentage()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      disputerDisputeRewardPercentage: instance
        .disputerDisputeRewardPercentage()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
      cumulativeFeeMultiplier: instance
        .cumulativeFeeMultiplier()
        .then((x: BigNumber) => x.toString())
        .catch(() => null),
    });
    return state;
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
        await emps.expired.create({ ...staticState, ...dynamicState, sponsors: eventState.sponsors, expired: true });
        // delete it from active
        await emps.active.delete(address);
      } else {
        // if it was never active, just create an expired emp
        await emps.expired.create({ ...staticState, ...dynamicState, sponsors: eventState.sponsors, expired: true });
      }
      // handle the case wehre emp is not yet expired
    } else {
      // if exists, pull all current state
      if (await emps.active.has(address)) {
        currentState = await emps.active.get(address);
        // if it doesnt exist we need to create it
      } else {
        // get static state once if it does not exist (optimizes network calls)
        staticState = await readEmpStaticState(instance, address);
        // create active emp with static/dynamic state
        currentState = await emps.active.create({ ...staticState, ...dynamicState });
      }
      // add any new sponsors
      await emps.active.addSponsors(address, eventState.sponsors || []);
    }
  }

  // add a set of all collateral addresses
  async function updateTokenAddresses() {
    const allEmps = await emps.active.values();
    allEmps.forEach((emp) => {
      if (emp.collateralCurrency) collateralAddresses.add(emp.collateralCurrency);
      if (emp.tokenCurrency) syntheticAddresses.add(emp.tokenCurrency);
    });
  }

  async function update(startBlock?: number | "latest", endBlock?: number) {
    await Promise.map(Array.from(await registeredEmps.values()), (address: string) =>
      updateOne(address, startBlock, endBlock)
    );
    await updateTokenAddresses();
  }

  return update;
};
