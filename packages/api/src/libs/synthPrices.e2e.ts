require("dotenv").config();
import assert from "assert";
import SynthPrices from "./synthPrices";
import Web3 from "web3";

// this is an integration test, dont run in ci
describe("synthPrices", function () {
  let web3: Web3, synthPrices: ReturnType<typeof SynthPrices>;
  const env = process.env;
  before(function () {
    assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
    web3 = new Web3(env.CUSTOM_NODE_URL);
    const config = {
      cryptowatchApiKey: env.cryptwatchApiKey,
      tradermadeApiKey: env.tradermadeApiKey,
      quandlApiKey: env.quandlApiKey,
    };
    synthPrices = SynthPrices(config, web3);
  });
  it("getCurrentPrice", async function () {
    const empAddress = "0xeE44aE0cff6E9E62F26add74784E573bD671F144";
    const result = await synthPrices.getCurrentPrice(empAddress);
    assert.ok(result);
    assert.ok(result[0]);
    assert.ok(result[1]);
  });
});
