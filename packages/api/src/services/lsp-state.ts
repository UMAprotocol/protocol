import * as uma from "@uma/sdk";
import { BatchRead, toString, toNumber, parseBytes, nowS } from "../libs/utils";
import { AppState } from "..";
import { lsps } from "../tables";

type Instance = uma.clients.lsp.Instance;
type Config = undefined;
type Dependencies = Pick<
  AppState,
  "lsps" | "registeredLsps" | "provider" | "collateralAddresses" | "shortAddresses" | "longAddresses" | "multicall"
>;

export default (config: Config, appState: Dependencies) => {
  const { lsps, registeredLsps, provider, collateralAddresses, shortAddresses, longAddresses, multicall } = appState;

  // default props we want to query on contract
  const staticProps: [string, (x: any) => any][] = [
    // TODO: deal with this when early contracts dont have pairName
    // ["pairName", parseBytes],
    ["collateralPerPair", toString],
    ["priceIdentifier", parseBytes],
    ["collateralToken", toString],
    ["longToken", toString],
    ["shortToken", toString],
    ["finder", toString],
    ["financialProductLibrary", toString],
    ["customAncillaryData", toString],
    ["prepaidProposerReward", toString],
    ["expirationTimestamp", toNumber],
  ];

  const dynamicProps: [string, (x: any) => any][] = [
    ["expiryPrice", toString],
    ["expiryPercentLong", toString],
    ["contractState", toNumber],
  ];

  async function batchRead(calls: [string, (x: any) => any][], instance: Instance, address: string) {
    const result = await BatchRead(multicall)(calls, instance);
    return {
      address,
      updated: nowS(),
      ...result,
    };
  }
  async function updateLsp(address: string, startBlock?: number | "latest", endBlock?: number) {
    // ignored expired lsps
    if (await lsps.expired.has(address)) return;
    const instance = uma.clients.lsp.connect(address, provider);
    let currentState: lsps.Data = { address };
    let staticState: lsps.Data = { address };
    let dynamicState: lsps.Data = { address };
    let eventState: uma.clients.lsp.EventState = { sponsors: [] };

    const events = await instance.queryFilter({}, startBlock, endBlock);
    // returns all sponsors ( this should really be a seperate table eventually)
    eventState = await uma.clients.lsp.getEventState(events);
    dynamicState = await batchRead(dynamicProps, instance, address);

    if (eventState.expired) {
      // see if it used to be active
      if (await lsps.active.has(address)) {
        // get state
        currentState = await lsps.active.get(address);
        await lsps.expired.create({
          ...currentState,
          ...dynamicState,
          expired: true,
        });
        await lsps.expired.addSponsors(address, eventState.sponsors || []);
        // delete it from active
        await lsps.active.delete(address);
      } else {
        // have to make sure we get static state if we have never seen this expired emp before
        staticState = await batchRead(staticProps, instance, address);
        // if it was never active, just create an expired emp
        await lsps.expired.create({ ...staticState, ...dynamicState, sponsors: eventState.sponsors, expired: true });
      }
      // handle the case wehre emp is not yet expired
    } else {
      // if it doesnt exist we need to create it
      if (!(await lsps.active.has(address))) {
        // get static state once if it does not exist (optimizes network calls)
        staticState = await batchRead(staticProps, instance, address);
        // create active emp with static/dynamic state
        await lsps.active.create({ ...staticState, ...dynamicState });
      }
      // add any new sponsors
      await lsps.active.addSponsors(address, eventState.sponsors || []);
    }
  }
  async function updateLsps(addresses: string[], startBlock?: number | "latest", endBlock?: number) {
    return Promise.allSettled(
      addresses.map(async (address) => {
        return updateLsp(address, startBlock, endBlock);
      })
    );
  }
  async function updateTokenAddresses() {
    const allLsps = [...(await lsps.active.values()), ...(await lsps.expired.values())];
    allLsps.forEach((lsp) => {
      if (lsp.collateralToken) collateralAddresses.add(lsp.collateralToken);
      if (lsp.longToken) longAddresses.add(lsp.longToken);
      if (lsp.shortToken) shortAddresses.add(lsp.shortToken);
    });
  }

  async function update(startBlock?: number | "latest", endBlock?: number) {
    const addresses = Array.from(await registeredLsps.values());
    await updateLsps(addresses, startBlock, endBlock).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error Updating LSP State: " + result.reason.message);
      });
    });
    await updateTokenAddresses();
  }

  return {
    update,
    utils: {
      updateTokenAddresses,
      updateLsps,
      updateLsp,
      dynamicProps,
      staticProps,
      batchRead,
    },
  };
};
