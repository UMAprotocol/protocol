import * as uma from "@uma/sdk";
import Promise from "bluebird";
const { emp } = uma.clients;
import { BatchReadWithErrors, nowS, parseBytes, Profile, toNumber, toString } from "../libs/utils";
import { AppClients, AppState, BaseConfig } from "../types";

type Instance = uma.clients.emp.Instance;
type Config = BaseConfig & {
  updateEmpsConcurrency?: number;
};
type Dependencies = {
  tables: Pick<AppState, "registeredEmps" | "emps" | "collateralAddresses" | "syntheticAddresses">;
  appClients: AppClients;
};

export const EmpState = (config: Config, dependencies: Dependencies) => {
  const { appClients, tables } = dependencies;
  const { registeredEmps, emps, collateralAddresses, syntheticAddresses } = tables;
  const { multicall2, provider } = appClients;

  const profile = Profile(config.debug);
  // default props we want to query on contract
  const staticProps: [string, (x: any) => any][] = [
    ["priceIdentifier", parseBytes],
    ["expirationTimestamp", toNumber],
    ["withdrawalLiveness", toNumber],
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

  const dynamicProps: [string, (x: any) => any][] = [
    ["totalTokensOutstanding", toString],
    ["totalPositionCollateral", toString],
    ["rawTotalPositionCollateral", toString],
    ["expiryPrice", toString],
  ];

  async function batchRead(calls: [string, (x: any) => any][], instance: Instance, address: string) {
    const result = await BatchReadWithErrors(multicall2)(calls, instance);
    return {
      address,
      updated: nowS(),
      ...result,
    };
  }

  async function readEmpDynamicState(instance: Instance, address: string) {
    return batchRead(dynamicProps, instance, address);
  }

  async function readEmpStaticState(instance: Instance, address: string) {
    return batchRead(staticProps, instance, address);
  }

  async function updateOne(address: string, startBlock?: number, endBlock?: number) {
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

      // set created timestamp if needed
      await updateCreatedTimestamp(address, emps.expired);
    } else {
      // if it doesnt exist we need to create it
      if (!(await emps.active.has(address))) {
        // get static state once if it does not exist (optimizes network calls)
        staticState = await readEmpStaticState(instance, address);
        // create active emp with static/dynamic state
        await emps.active.create({ ...staticState, ...dynamicState });
      } else {
        await emps.active.update(address, dynamicState);
      }
      // add any new sponsors
      await emps.active.addSponsors(address, eventState.sponsors || []);

      // set created timestamp if needed
      await updateCreatedTimestamp(address, emps.active);
    }
  }

  async function updateCreatedTimestamp(address: string, table: uma.tables.emps.Table) {
    const emp = await table.get(address);
    if (emp.createdTimestamp) return;

    const { blockNumber } = await registeredEmps.get(address);
    if (typeof blockNumber !== "number") return;

    const block = await provider.getBlock(blockNumber);
    await table.setCreatedTimestamp(address, block.timestamp);
  }

  // add a set of all collateral addresses
  async function updateTokenAddresses() {
    const allEmps = [...(await emps.active.values()), ...(await emps.expired.values())];
    await Promise.all([allEmps.map((emp) => updateTokenAddress(emp))]);
  }

  async function updateTokenAddress(emp: uma.tables.emps.Data) {
    if (emp.collateralCurrency) await collateralAddresses.set(emp.collateralCurrency);
    if (emp.tokenCurrency) await syntheticAddresses.set(emp.tokenCurrency);
  }

  async function updateAll(addresses: string[], startBlock?: number, endBlock?: number) {
    const { updateEmpsConcurrency = 10 } = config;
    await Promise.map(
      addresses,
      async (address: string) => {
        const end = profile(`Update Emp state for ${address}`);
        try {
          return await updateOne(address, startBlock, endBlock);
        } catch (err) {
          console.error(err);
        } finally {
          end();
        }
      },
      { concurrency: updateEmpsConcurrency }
    );
  }

  async function update(startBlock?: number, endBlock?: number) {
    const addresses = await registeredEmps.keys();
    await updateAll(addresses, startBlock, endBlock);
    await updateTokenAddresses();
  }

  return {
    update,
    updateAll,
  };
};

export type EmpState = ReturnType<typeof EmpState>;
