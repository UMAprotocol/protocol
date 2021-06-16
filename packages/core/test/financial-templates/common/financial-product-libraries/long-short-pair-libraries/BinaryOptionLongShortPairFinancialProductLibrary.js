const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const BinaryOptionLongShortPairFinancialProductLibrary = artifacts.require(
  "BinaryOptionLongShortPairFinancialProductLibrary"
);

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.
const ExpiringContractMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("3000"));

contract("BinaryOptionLongShortPairFinancialProductLibrary", function () {
  let binaryLSPFPL;
  let expiringContractMock;

  beforeEach(async () => {
    binaryLSPFPL = await BinaryOptionLongShortPairFinancialProductLibrary.new();
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
      await binaryLSPFPL.setLongShortPairParameters(expiringContractMock.address, strikePrice);

      const setParams = await binaryLSPFPL.LongShortPairParameters(expiringContractMock.address);
      assert.isTrue(setParams.isSet);
      assert.equal(setParams.strikePrice.toString(), strikePrice);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await binaryLSPFPL.setLongShortPairParameters(expiringContractMock.address, strikePrice);

      // Second attempt should revert.
      assert(
        await didContractThrow(binaryLSPFPL.setLongShortPairParameters(expiringContractMock.address, strikePrice))
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(await didContractThrow(binaryLSPFPL.setLongShortPairParameters(ZERO_ADDRESS, strikePrice)));
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await binaryLSPFPL.setLongShortPairParameters(expiringContractMock.address, strikePrice);
    });
    it("Lower than lower bound should return 0", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.computeExpiryTokensForCollateral.call(toWei("2500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0"));
    });
    it("equal to upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.computeExpiryTokensForCollateral.call(toWei("3000"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.computeExpiryTokensForCollateral.call(toWei("3500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("2000"), toWei("3000"), toWei("4000"), toWei("5000"), toWei("10000")]) {
        const expiraryTokensForCollateral = await binaryLSPFPL.computeExpiryTokensForCollateral.call(price, {
          from: expiringContractMock.address,
        });
        const expectedPrice = toBN(price).gte(toBN(strikePrice)) ? toWei("1") : toWei("0");

        assert.equal(expiraryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
