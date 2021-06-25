import assert from "assert";
import SynthPrices from "../libs/synthPrices";
import { AppState, PriceSample } from "..";
import * as uma from "@uma/sdk";

type Config = {
  cryptowatchApiKey?: string;
  tradermadeApiKey?: string;
  quandlApiKey?: string;
  defipulseApiKey?: string;
  priceFeedDecimals?: number;
};

type Dependencies = Pick<AppState, "web3" | "emps" | "synthPrices">;

export default function (config: Config, appState: Dependencies) {
  const { web3, emps, synthPrices } = appState;
  const getSynthPrices = SynthPrices(config, web3);

  // if we have a new emp address, this will create a new price table structure to store historical price data
  function getOrCreateHistoryTable(empAddress: string) {
    if (synthPrices.history[empAddress] == null) {
      synthPrices.history[empAddress] = uma.tables.historicalPrices.SortedJsMap();
    }
    return synthPrices.history[empAddress];
  }

  // utility to grab last price based on address
  function getLatestPriceFromTable(empAddress: string) {
    const result = synthPrices.latest[empAddress];
    assert(uma.utils.exists(result), "no latest sythetic price found for: " + empAddress);
    return result;
  }

  // pulls price from latest and stuffs it into historical table.
  async function updatePriceHistory(empAddress: string) {
    const table = getOrCreateHistoryTable(empAddress);
    const [timestamp, price] = getLatestPriceFromTable(empAddress);
    // if this timestamp exists in the table, dont bother re-adding it
    assert(uma.utils.exists(price), "No latest price available for: " + empAddress);
    assert(
      !(await table.hasByTimestamp(timestamp)),
      `Synthetic price already exists for emp address ${empAddress} at timestamp: ${timestamp}`
    );
    return table.create({ timestamp, price });
  }

  async function updatePriceHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updatePriceHistory));
  }

  async function updateLatestPrice(empAddress: string) {
    const result: PriceSample = await getSynthPrices.getCurrentPrice(empAddress);
    synthPrices.latest[empAddress] = result;
    return result;
  }

  async function updateLatestPrices(empAddresses: string[]) {
    return Promise.allSettled(empAddresses.map(updateLatestPrice));
  }

  async function update() {
    // synth prices are looked up by emp address, not synthetic token address
    const empAddresses = Array.from(await emps.active.keys());
    await updateLatestPrices(empAddresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating synthetic price: " + result.reason.message);
      });
    });
    await updatePriceHistories(empAddresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected")
          console.error("Error updating historical synthetic price: " + result.reason.message);
      });
    });
  }

  return {
    update,
    utils: {
      getOrCreateHistoryTable,
      getLatestPriceFromTable,
      updatePriceHistories,
      updatePriceHistory,
      updateLatestPrice,
      updateLatestPrices,
    },
  };
}
