const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const LinearContractForDiffrenceFinancialProductLibrary = artifacts.require(
  "LinearContractForDiffrenceFinancialProductLibrary"
);

// helper contracts. To test CFD libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const upperBound = toBN(toWei("2000"));
const lowerBound = toBN(toWei("1000"));

contract("LinearContractForDiffrenceFinancialProductLibrary", function () {
  let linearCFDFPL;
  let expiringContractMock;

  beforeEach(async () => {
    linearCFDFPL = await LinearContractForDiffrenceFinancialProductLibrary.new();
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    );
  });
  describe("Contract For diffrence Paramaterization", () => {
    it("Can set and fetch valid values", async () => {
      await linearCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, upperBound, lowerBound);

      const setParams = await linearCFDFPL.contractForDifferenceParameters(expiringContractMock.address);
      assert.equal(setParams.upperBound.toString(), upperBound);
      assert.equal(setParams.lowerBound.toString(), lowerBound);
    });
    it("Can not re-use existing CFD contract address", async () => {
      await linearCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, upperBound, lowerBound);

      // Second attempt should revert.
      assert(
        await didContractThrow(
          linearCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, upperBound, lowerBound)
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          linearCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, lowerBound, upperBound)
        )
      );
    });
    it("Can not set invalid CFD contract address", async () => {
      // CFD Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(linearCFDFPL.setContractForDifferenceParameters(ZERO_ADDRESS, upperBound, lowerBound))
      );
    });
  });
  describe("Compute expirary tokens for collateral", () => {
    beforeEach(async () => {
      await linearCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, upperBound, lowerBound);
    });
    it("Lower than lower bound should return 0", async () => {
      const expiraryTokensForCollateral = await linearCFDFPL.computeExpiraryTokensForCollateral.call(toWei("900"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await linearCFDFPL.computeExpiraryTokensForCollateral.call(toWei("2100"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });
    it("Midway between bounds should return 0.5", async () => {
      const expiraryTokensForCollateral = await linearCFDFPL.computeExpiraryTokensForCollateral.call(toWei("1500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0.5"));
    });

    it("Arbitary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("1200"), toWei("1400"), toWei("1600"), toWei("1800"), toWei("2000")]) {
        const expiraryTokensForCollateral = await linearCFDFPL.computeExpiraryTokensForCollateral.call(price, {
          from: expiringContractMock.address,
        });
        const numerator = toBN(price).sub(toBN(lowerBound));
        const denominator = toBN(upperBound).sub(toBN(lowerBound));
        const expectedPrice = numerator.mul(toBN(toWei("1"))).div(denominator);
        assert.equal(expiraryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
