const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const CoveredCallContractForDifferenceFinancialProductLibrary = artifacts.require(
  "CoveredCallContractForDifferenceFinancialProductLibrary"
);

// helper contracts. To test CFD libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toWei("400");

contract("CoveredCallContractForDifferenceFinancialProductLibrary", function () {
  let callOptionCFDFPL;
  let expiringContractMock;

  beforeEach(async () => {
    callOptionCFDFPL = await CoveredCallContractForDifferenceFinancialProductLibrary.new();
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    );
  });
  describe("Contract For diffrence Paramaterization", () => {
    it("Can set and fetch valid strikes", async () => {
      await callOptionCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);

      const setStrike = await callOptionCFDFPL.contractForDifferenceStrikePrices(expiringContractMock.address);
      assert.equal(setStrike.toString(), strikePrice);
    });
    it("Can not re-use existing CFD contract address", async () => {
      await callOptionCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);

      // Second attempt should revert.
      assert(
        await didContractThrow(
          callOptionCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice)
        )
      );
    });
    it("Can not set invalid CFD contract address", async () => {
      // CFD Address must implement the `expirationTimestamp method.
      assert(await didContractThrow(callOptionCFDFPL.setContractForDifferenceParameters(ZERO_ADDRESS, strikePrice)));
    });
  });
  describe("Compute expirary tokens for collateral", () => {
    beforeEach(async () => {
      await callOptionCFDFPL.setContractForDifferenceParameters(expiringContractMock.address, strikePrice);
    });
    it("Lower than strike should return 0", async () => {
      const expiraryTokensForCollateral = await callOptionCFDFPL.computeExpiryTokensForCollateral.call(toWei("300"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0"));
    });
    it("Higher than strike correct value", async () => {
      const expiraryTokensForCollateral = await callOptionCFDFPL.computeExpiryTokensForCollateral.call(toWei("500"), {
        from: expiringContractMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Arbitary expirary price above strike should return correctly", async () => {
      for (const price of [toWei("500"), toWei("600"), toWei("1000"), toWei("1500"), toWei("2000")]) {
        const expiraryTokensForCollateral = await callOptionCFDFPL.computeExpiryTokensForCollateral.call(price, {
          from: expiringContractMock.address,
        });
        const expectedPrice = toBN(price)
          .sub(toBN(strikePrice))
          .mul(toBN(toWei("1")))
          .div(toBN(price));
        assert.equal(expiraryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
    it("Should never return a value greater than 1", async () => {
      // create a massive expiry price. 1e18*1e18. Under all conditions should return less than 1.
      const expiraryTokensForCollateral = await callOptionCFDFPL.computeExpiryTokensForCollateral.call(
        toWei(toWei("1")),
        { from: expiringContractMock.address }
      );
      assert.isTrue(toBN(expiraryTokensForCollateral).lt(toBN(toWei("1"))));
    });
  });
});
