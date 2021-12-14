import dotenv from "dotenv";
import assert from "assert";
import * as across from ".";
import { ethers } from "ethers";
import { fromWei, toWei } from "./utils";
import { ADDRESSES } from "./constants";
dotenv.config();

const usdcAddress = ADDRESSES.USDC;
const umaAddress = ADDRESSES.UMA;

describe("gasFeeCalculator", function () {
  let provider: ethers.providers.BaseProvider;
  beforeAll(async function () {
    provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
  });
  describe("gasFeeCalculator.getGasFee", function () {
    // example of how to get gas price
    test("get current gas price", async function () {
      // returns price as BN in wei
      const result = await provider.getGasPrice();
      assert.ok(fromWei(result));
    });
    test("gas fee eth e2e", async function () {
      const gas = across.constants.SLOW_ETH_GAS;
      const result = await across.gasFeeCalculator.getGasFee(provider, gas);
      assert.ok(fromWei(result));
    });
    test("gas fee uma e2e", async function () {
      const gas = across.constants.SLOW_UMA_GAS;
      const result = await across.gasFeeCalculator.getGasFee(provider, gas, umaAddress);
      assert.ok(fromWei(result));
    });
    test("gas fee usdc e2e", async function () {
      const gas = across.constants.SLOW_UMA_GAS;
      const result = await across.gasFeeCalculator.getGasFee(provider, gas, usdcAddress);
      // 6 decimals for usdc
      assert.ok(fromWei(result, 6));
    });
  });
  describe("gasFeeCalculator.getDepositFees", function () {
    Object.entries(ADDRESSES).forEach(([name, address]) => {
      test(`deposit fee ${name}`, async function () {
        const amount = toWei("100");
        const result = await across.gasFeeCalculator.getDepositFees(provider, amount, address);
        assert.ok(fromWei(result.slowPct));
        assert.ok(fromWei(result.instantPct));
      });
    });
  });
});
