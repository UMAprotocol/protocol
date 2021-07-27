import * as uma from "@uma/sdk";
import { BatchRead, toString, toNumber, parseBytes, nowS } from "../libs/utils";
import { AppState, BaseConfig } from "..";
import { lsps } from "../tables";
import { BigNumber } from "ethers";

type Instance = uma.clients.lsp.Instance;
type Config = BaseConfig;
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

  async function getStaticProps(instance: Instance, address: string) {
    return batchRead(staticProps, instance, address);
  }
  async function getDynamicProps(instance: Instance, address: string) {
    return batchRead(dynamicProps, instance, address);
  }
  // this is not ideal, but contract does not have a way to query this directly. this is a dyanmic value which
  // depends first on gettin the static value 'collateralToken'.
  async function getPositionCollateral(instance: Instance, address: string) {
    const collateralToken = await instance.collateralToken();
    return getErc20BalanceOf(collateralToken, address);
  }
  // get token state based on contract
  async function getErc20BalanceOf(erc20Address: string, userAddress: string) {
    const instance = uma.clients.erc20.connect(erc20Address, provider);
    return instance
      .balanceOf(userAddress)
      .then((x: BigNumber) => x.toString())
      .catch(() => "0");
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
    dynamicState = await getDynamicProps(instance, address);
    const totalPositionCollateral = await getPositionCollateral(instance, address);

    if (eventState.expired) {
      // see if it used to be active
      if (await lsps.active.has(address)) {
        // get state
        currentState = await lsps.active.get(address);
        await lsps.expired.create({
          ...currentState,
          ...dynamicState,
          totalPositionCollateral,
          expired: true,
        });
        await lsps.expired.addSponsors(address, eventState.sponsors || []);
        // delete it from active
        await lsps.active.delete(address);
      } else {
        // have to make sure we get static state if we have never seen this expired emp before
        staticState = await getStaticProps(instance, address);
        // if it was never active, just create an expired emp
        await lsps.expired.create({
          ...staticState,
          ...dynamicState,
          totalPositionCollateral,
          sponsors: eventState.sponsors,
          expired: true,
        });
      }
      // handle the case wehre emp is not yet expired
    } else {
      // if it doesnt exist we need to create it
      if (!(await lsps.active.has(address))) {
        // get static state once if it does not exist (optimizes network calls)
        staticState = await getStaticProps(instance, address);
        // create active emp with static/dynamic state
        await lsps.active.create({
          ...staticState,
          ...dynamicState,
          totalPositionCollateral,
        });
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
      getErc20BalanceOf,
      getStaticProps,
      getDynamicProps,
      getPositionCollateral,
    },
  };
};
