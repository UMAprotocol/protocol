import SynthPrices from "../libs/synthPrices";
import { AppState, PriceSample } from "..";

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
  const getSynthPrices = SynthPrices(config, { web3 });

  async function updatePrice(empAddress: string) {
    const result: PriceSample = await getSynthPrices.getCurrentPrice(empAddress);
    synthPrices.latest[empAddress] = result;
    return result;
  }
  async function updatePrices(empAddresses: string[]) {
    return Promise.allSettled(empAddresses.map(updatePrice));
  }

  async function update() {
    // synth prices are looked up by emp address, not synthetic token address
    const empAddresses = Array.from(await emps.active.keys());
    await updatePrices(empAddresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating synthetic price: " + result.reason.message);
      });
    });
  }

  return {
    update,
    utils: {
      updatePrice,
      updatePrices,
    },
  };
}
