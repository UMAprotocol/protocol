import dotenv from "dotenv";
import assert from "assert";
import * as across from ".";
import { ethers } from "ethers";
import { fromWei, toWei } from "./utils";
import { ADDRESSES } from "./constants";
dotenv.config();

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
    Object.entries(ADDRESSES).forEach(([name, address]) => {
      test(`get gas fee ${name}`, async function () {
        const gas = across.gasFeeCalculator.getSlowGasByAddress(address);
        const result = await across.gasFeeCalculator.getGasFee(provider, gas, address);
        assert.ok(fromWei(result));
      });
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
