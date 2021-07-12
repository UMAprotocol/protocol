import bluebird from "bluebird";
import { AppState } from "..";
import { parseUnits, nowS } from "../libs/utils";

type Config = undefined;

type Dependencies = Pick<AppState, "zrx" | "marketPrices" | "collateralAddresses" | "syntheticAddresses">;

// market prices are pulled from the 0x matcha api
export default function (config: Config, appState: Dependencies) {
  // these prices will be quoted against usdc by default, but can be specified as address or symbol
  const { zrx, marketPrices, collateralAddresses, syntheticAddresses } = appState;
  // this is hardcoded for now since it differs from the standard currency symbol usd
  const currency = "usdc";

  // does not do any queries, just a helper to mutate the latest price table
  async function updateLatestPrice(tokenAddress: string, timestampS: number) {
    const result = await zrx.price({
      sellToken: tokenAddress,
      buyToken: currency.toUpperCase(),
      // default to selling 1 of the synthetic
      sellAmount: parseUnits("1").toString(),
    });
    // we need to store prices in wei, so use parse units on this price
    marketPrices.usdc.latest[tokenAddress] = [timestampS, parseUnits(result.price.toString()).toString()];
  }

  async function updateLatestPrices(addresses: string[], timestampS: number = nowS()) {
    return bluebird.mapSeries(addresses, async (address) => {
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
      }
    });
  }
  // we can try to price all known erc20 addresses. Some will fail. Also this endpoint does not return a timestamp
  // so we will just set one from our query time.
  async function update(timestampS = nowS()) {
    const addresses = Array.from(collateralAddresses.values()).concat(Array.from(syntheticAddresses.values()));
    await updateLatestPrices(addresses, timestampS).catch((err) => {
      console.error("Error getting Market Price: " + err.message);
    });
  }

  return {
    update,
  };
}
