import bluebird from "bluebird";
import assert from "assert";
import lodash from "lodash";
import { AppClients, AppState, BaseConfig } from "../types";
import { parseUnits, nowS, Profile } from "../libs/utils";

type Config = BaseConfig;

type Dependencies = {
  tables: Pick<AppState, "marketPrices" | "collateralAddresses" | "syntheticAddresses" | "erc20s">;
  appClients: AppClients;
};

// market prices are pulled from the 0x matcha api
export function MarketPrices(config: Config, dependencies: Dependencies) {
  // these prices will be quoted against usdc by default, but can be specified as address or symbol
  const { appClients, tables } = dependencies;
  const { marketPrices, collateralAddresses, syntheticAddresses, erc20s } = tables;
  const { zrx } = appClients;
  // this is hardcoded for now since it differs from the standard currency symbol usd
  const currency = "usdc";
  const profile = Profile(config.debug);

  // does not do any queries, just a helper to mutate the latest price table
  async function updateLatestPrice(tokenAddress: string, timestampS: number) {
    const tokenData = await erc20s.get(tokenAddress);
    const result = await zrx.price({
      sellToken: tokenAddress,
      buyToken: currency.toUpperCase(),
      // default to selling 1 of the synthetic
      sellAmount: parseUnits("1", tokenData.decimals || 18).toString(),
    });
    // we need to store prices in wei, so use parse units on this price
    await marketPrices.usdc.latest.set({
      id: tokenAddress,
      address: tokenAddress,
      price: parseUnits(result.price.toString()).toString(),
      timestamp: timestampS,
    });
  }

  async function updateLatestPrices(addresses: string[], timestampS: number = nowS()) {
    return bluebird.mapSeries(addresses, async (address) => {
      const end = profile(`Latest market price for ${address}`);
      try {
        return {
          status: "fullfilled",
          value: await updateLatestPrice(address, timestampS),
        };
      } catch (err) {
        return {
          status: "rejected",
          reason: err,
        };
      } finally {
        end();
      }
    });
  }

  function getHistoryTable() {
    return marketPrices.usdc.history;
  }
  async function getLatestPrice(address: string) {
    const result = await marketPrices.usdc.latest.get(address);
    assert(result, "No price found for token address: " + address);
    return result;
  }
  // pulls price from latest and stuffs it into historical table.
  async function updatePriceHistory(tokenAddress: string) {
    const table = getHistoryTable();
    const { timestamp, price } = await getLatestPrice(tokenAddress);
    if (await table.hasByAddress(tokenAddress, timestamp)) return;
    return table.create({
      address: tokenAddress,
      value: price,
      timestamp,
    });
  }

  async function updatePriceHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updatePriceHistory));
  }
  // we can try to price all known erc20 addresses. Some will fail. Also this endpoint does not return a timestamp
  // so we will just set one from our query time.
  async function update(timestampS = nowS()) {
    // want to make sure we dont have any duplicate addresses between collaterals and synthetic
    const addresses = lodash.uniq((await collateralAddresses.keys()).concat(await syntheticAddresses.keys()));
    await updateLatestPrices(addresses, timestampS).catch((err) => {
      console.error("Error getting Market Price: " + err.message);
    });
    await updatePriceHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected")
          console.error("Error Updating Market Price History: " + result.reason.message);
      });
    });
  }

  return {
    update,
    utils: {
      updatePriceHistories,
      updatePriceHistory,
    },
  };
}

export type MarketPrices = ReturnType<typeof MarketPrices>;
