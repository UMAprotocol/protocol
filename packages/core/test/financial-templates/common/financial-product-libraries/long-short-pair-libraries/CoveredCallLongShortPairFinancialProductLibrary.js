const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const CoveredCallLongShortPairFinancialProductLibrary = getContract("CoveredCallLongShortPairFinancialProductLibrary");

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toWei("400");

describe("CoveredCallLongShortPairFinancialProductLibrary", function () {
  let callOptionLSPFPL;
  let expiringContractMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    callOptionLSPFPL = await CoveredCallLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid strikes", async () => {
      await callOptionLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      const setStrike = await callOptionLSPFPL.methods
        .longShortPairStrikePrices(expiringContractMock.options.address)
        .call();
      assert.equal(setStrike.toString(), strikePrice);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await callOptionLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          callOptionLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          callOptionLSPFPL.methods.setLongShortPairParameters(ZERO_ADDRESS, strikePrice).send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await callOptionLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });
    });
    it("Lower than strike should return 0", async () => {
      const expiryTokensForCollateral = await callOptionLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("300"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0"));
    });
    it("Higher than strike correct value", async () => {
      const expiryTokensForCollateral = await callOptionLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("500"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Arbitrary expiry price above strike should return correctly", async () => {
      for (const price of [toWei("500"), toWei("600"), toWei("1000"), toWei("1500"), toWei("2000")]) {
        const expiryTokensForCollateral = await callOptionLSPFPL.methods
          .percentageLongCollateralAtExpiry(price)
          .call({ from: expiringContractMock.options.address });
        const expectedPrice = toBN(price)
          .sub(toBN(strikePrice))
          .mul(toBN(toWei("1")))
          .div(toBN(price));
        assert.equal(expiryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
    it("Should never return a value greater than 1", async () => {
      // create a massive expiry price. 1e18*1e18. Under all conditions should return less than 1.
      const expiryTokensForCollateral = await callOptionLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei(toWei("1")))
        .call({ from: expiringContractMock.options.address });
      assert.isTrue(toBN(expiryTokensForCollateral).lt(toBN(toWei("1"))));
    });
  });
});
