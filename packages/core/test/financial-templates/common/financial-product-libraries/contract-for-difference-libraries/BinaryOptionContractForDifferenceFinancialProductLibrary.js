const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const BinaryOptionContractForDifferenceFinancialProductLibrary = artifacts.require(
  "BinaryOptionContractForDifferenceFinancialProductLibrary"
);

// helper contracts. To test CFD libraries we simply need a financial contract with an `expirationTimestamp` method.
const ExpiringContractMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("3000"));

contract("BinaryOptionContractForDifferenceFinancialProductLibrary", function () {
  let binaryCFDFPL;
  let expiringContractMock;

  beforeEach(async () => {
    binaryCFDFPL = await BinaryOptionContractForDifferenceFinancialProductLibrary.new();
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    );
  });
  describe("Contract For difference Parameterization", () => {
    it("Can set and fetch valid values", async () => {
      await binaryCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);

      const setParams = await binaryCFDFPL.contractForDifferenceParameters(expiringContractMock.address);
      assert.isTrue(setParams.isSet);
      assert.equal(setParams.strikePrice.toString(), strikePrice);
    });
    it("Can not re-use existing CFD contract address", async () => {
      await binaryCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);

      // Second attempt should revert.
      assert(
        await didContractThrow(
          binaryCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice)
        )
      );
    });
    it("Can not set invalid CFD contract address", async () => {
      // CFD Address must implement the `expirationTimestamp method.
      assert(await didContractThrow(binaryCFDFPL.setContractForDifferenceParameters(ZERO_ADDRESS, strikePrice)));
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await binaryCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);
    });
    it("Lower than lower bound should return 0", async () => {
      const expiraryTokensForCollateral = await binaryCFDFPL.computeExpiryTokensForCollateral.call(toWei("2500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0"));
    });
    it("equal to upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryCFDFPL.computeExpiryTokensForCollateral.call(toWei("3000"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryCFDFPL.computeExpiryTokensForCollateral.call(toWei("3500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("2000"), toWei("3000"), toWei("4000"), toWei("5000"), toWei("10000")]) {
        const expiraryTokensForCollateral = await binaryCFDFPL.computeExpiryTokensForCollateral.call(price, {
          from: expiringContractMock.address,
        });
        const expectedPrice = toBN(price).gte(toBN(strikePrice)) ? toWei("1") : toWei("0");

        assert.equal(expiraryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
