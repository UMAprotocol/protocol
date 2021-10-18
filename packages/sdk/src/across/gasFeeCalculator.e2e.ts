import dotenv from "dotenv";
import assert from "assert";
import * as across from ".";
import { ethers } from "ethers";
import { fromWei, toWei } from "./utils";
dotenv.config();

const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const umaAddress = "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828";

describe("gasFeeCalculator", function () {
  let provider: ethers.providers.BaseProvider;
  beforeAll(async function () {
    provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
  });
  // example of how to get gas price
  test("get current gas price", async function () {
    // returns price as BN in wei
    const result = await provider.getGasPrice();
    assert.ok(fromWei(result));
  });
  test("gas fee eth e2e", async function () {
    const totalRelayed = toWei(1);
    const gas = across.constants.SLOW_ETH_GAS;
    const result = await across.gasFeeCalculator(provider, totalRelayed, gas);
    assert.ok(fromWei(result.gasFees));
    assert.ok(fromWei(result.feesAsPercent));
  });
  test("gas fee uma e2e", async function () {
    const totalRelayed = toWei(10);
    const gas = across.constants.SLOW_UMA_GAS;
    const result = await across.gasFeeCalculator(provider, totalRelayed, gas, umaAddress);
    assert.ok(fromWei(result.gasFees));
    assert.ok(fromWei(result.feesAsPercent));
  });
  test("gas fee usdc e2e", async function () {
    const totalRelayed = toWei(100, 6);
    const gas = across.constants.SLOW_UMA_GAS;
    const result = await across.gasFeeCalculator(provider, totalRelayed, gas, usdcAddress);
    // 6 decimals for usdc
    assert.ok(fromWei(result.gasFees, 6));
    assert.ok(fromWei(result.feesAsPercent));
  });
});
