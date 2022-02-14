// Script to test
const RoundingUtils = require("../dist/RoundingUtils");
const BigNumber = require("bignumber.js");
const Web3 = require("web3");
const { assert } = require("chai");

const { roundToDecimal } = RoundingUtils;
const { toBN, toWei } = Web3.utils;

describe("RoundingUtils.js", function () {
  describe("roundToDecimal", function () {
    it("rounds down if next decimal < 5 for positive number", function () {
      const rawAmount = toBN(toWei("1.123"));
      const inputDecimals = 18;
      const roundingPrecision = 2;
      const expectedRoundedAmount = toBN(toWei("1.12"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("rounds up if next decimal >= 5 for positive number", function () {
      const rawAmount = toBN(toWei("1.125"));
      const inputDecimals = 18;
      const roundingPrecision = 2;
      const expectedRoundedAmount = toBN(toWei("1.13"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("rounds towards 0 if next decimal < 5 for negative number", function () {
      const rawAmount = toBN(toWei("-1.123"));
      const inputDecimals = 18;
      const roundingPrecision = 2;
      const expectedRoundedAmount = toBN(toWei("-1.12"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("rounds away from 0 if next decimal >= 5 for negative number", function () {
      const rawAmount = toBN(toWei("-1.125"));
      const inputDecimals = 18;
      const roundingPrecision = 2;
      const expectedRoundedAmount = toBN(toWei("-1.13"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("rounds down to nearest million if below 500k threshold", function () {
      const rawAmount = toBN(toWei("1499999"));
      const inputDecimals = 18;
      const roundingPrecision = -6;
      const expectedRoundedAmount = toBN(toWei("1000000"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("rounds up to nearest million starting from next 500k threshold", function () {
      const rawAmount = toBN(toWei("1500000"));
      const inputDecimals = 18;
      const roundingPrecision = -6;
      const expectedRoundedAmount = toBN(toWei("2000000"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("check if rounding works for non-scaled decimals", function () {
      const rawAmount = toBN("1500000");
      const inputDecimals = 0;
      const roundingPrecision = -6;
      const expectedRoundedAmount = toBN("2000000");
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
    it("check floor rounding for positive number where next decimal >= 5", function () {
      const rawAmount = toBN(toWei("1.125"));
      const inputDecimals = 18;
      const roundingPrecision = 2;
      const roundingMode = BigNumber.ROUND_FLOOR;
      const expectedRoundedAmount = toBN(toWei("1.12"));
      const roundedAmount = roundToDecimal(rawAmount, inputDecimals, roundingPrecision, roundingMode);
      assert.equal(roundedAmount.toString(), expectedRoundedAmount.toString());
    });
  });
});
