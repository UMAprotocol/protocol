const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const LinearLongShortPairFinancialProductLibrary = getContract("LinearLongShortPairFinancialProductLibrary");

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const upperBound = toBN(toWei("2000"));
const lowerBound = toBN(toWei("1000"));

describe("LinearLongShortPairFinancialProductLibrary", function () {
  let linearLSPFPL;
  let expiringContractMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    linearLSPFPL = await LinearLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
    expiringContractMock = await ExpiringContractMock.new(
      ZERO_ADDRESS, // _financialProductLibraryAddress
      "1000000", // _expirationTimestamp
      { rawValue: toWei("1.5") }, // _collateralRequirement
      utf8ToHex("TEST_IDENTIFIER"), // _priceIdentifier
      ZERO_ADDRESS // _timerAddress
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid values", async () => {
      await linearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound)
        .send({ from: accounts[0] });

      const setParams = await linearLSPFPL.methods.longShortPairParameters(expiringContractMock.options.address).call();
      assert.equal(setParams.upperBound.toString(), upperBound);
      assert.equal(setParams.lowerBound.toString(), lowerBound);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await linearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          linearLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          linearLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, lowerBound, upperBound)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          linearLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, upperBound, lowerBound)
            .send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await linearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound)
        .send({ from: accounts[0] });
    });
    it("Lower than lower bound should return 0", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("900"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("2100"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("1"));
    });
    it("Midway between bounds should return 0.5", async () => {
      const expiryTokensForCollateral = await linearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("1500"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.5"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("1200"), toWei("1400"), toWei("1600"), toWei("1800"), toWei("2000")]) {
        const expiryTokensForCollateral = await linearLSPFPL.methods
          .percentageLongCollateralAtExpiry(price)
          .call({ from: expiringContractMock.options.address });
        const numerator = toBN(price).sub(toBN(lowerBound));
        const denominator = toBN(upperBound).sub(toBN(lowerBound));
        const expectedPrice = numerator.mul(toBN(toWei("1"))).div(denominator);
        assert.equal(expiryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
