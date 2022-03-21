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
  describe("gasFeeCalculator.getDepositFeesDetails", function () {
    test(`deposit fee details eth no discount`, async function () {
      const address = ADDRESSES.ETH;
      const amount = toWei("1");
      const discount = 0;
      const feeLimit = 1;
      const result = await across.gasFeeCalculator.getDepositFeesDetails(provider, amount, address, feeLimit, discount);
      assert.ok(result.isAmountTooLow);
    });
    test(`deposit fee details eth with discount`, async function () {
      const address = ADDRESSES.ETH;
      const amount = toWei("1");
      const discount = 25;
      const feeLimit = 25;
      const result = await across.gasFeeCalculator.getDepositFeesDetails(provider, amount, address, feeLimit, discount);
      assert.ok(!result.isAmountTooLow);
    });
  });
});
