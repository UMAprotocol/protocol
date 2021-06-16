const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const LinearLongShortPairFinancialProductLibrary = artifacts.require("LinearLongShortPairFinancialProductLibrary");

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const upperBound = toBN(toWei("2000"));
const lowerBound = toBN(toWei("1000"));

contract("LinearLongShortPairFinancialProductLibrary", function () {
  let linearLSPFPL;
  let expiringContractMock;

  beforeEach(async () => {
    linearLSPFPL = await LinearLongShortPairFinancialProductLibrary.new();
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    );
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid values", async () => {
      await linearLSPFPL.setLongShortPairParameters(expiringContractMock.address, upperBound, lowerBound);

      const setParams = await linearLSPFPL.LongShortPairParameters(expiringContractMock.address);
      assert.equal(setParams.upperBound.toString(), upperBound);
      assert.equal(setParams.lowerBound.toString(), lowerBound);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await linearLSPFPL.setLongShortPairParameters(expiringContractMock.address, upperBound, lowerBound);

      // Second attempt should revert.
      assert(
        await didContractThrow(
          linearLSPFPL.setLongShortPairParameters(expiringContractMock.address, upperBound, lowerBound)
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          linearLSPFPL.setLongShortPairParameters(expiringContractMock.address, lowerBound, upperBound)
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(await didContractThrow(linearLSPFPL.setLongShortPairParameters(ZERO_ADDRESS, upperBound, lowerBound)));
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await linearLSPFPL.setLongShortPairParameters(expiringContractMock.address, upperBound, lowerBound);
    });
    it("Lower than lower bound should return 0", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.computeExpiryTokensForCollateral.call(toWei("900"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.computeExpiryTokensForCollateral.call(toWei("2100"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiryTokensForCollateral.toString(), toWei("1"));
    });
    it("Midway between bounds should return 0.5", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.computeExpiryTokensForCollateral.call(toWei("1500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.5"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("1200"), toWei("1400"), toWei("1600"), toWei("1800"), toWei("2000")]) {
        const expiryTokensForCollateral = await linearLSPFPL.computeExpiryTokensForCollateral.call(price, {
          from: expiringContractMock.address,
        });
        const numerator = toBN(price).sub(toBN(lowerBound));
        const denominator = toBN(upperBound).sub(toBN(lowerBound));
        const expectedPrice = numerator.mul(toBN(toWei("1"))).div(denominator);
        assert.equal(expiryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
