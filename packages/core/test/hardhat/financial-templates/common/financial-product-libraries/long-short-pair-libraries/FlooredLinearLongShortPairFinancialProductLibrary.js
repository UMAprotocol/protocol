const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, web3 } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FlooredLinearLongShortPairFinancialProductLibrary = getContract(
  "FlooredLinearLongShortPairFinancialProductLibrary"
);

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.

const ExpiringContractMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const upperBound = toBN(toWei("2000"));
const lowerBound = toBN(toWei("1000"));
const floorPercentage = toBN(toWei("0.5"));

describe("FlooredLinearLongShortPairFinancialProductLibrary", function () {
  let flooredLinearLSPFPL;
  let expiringContractMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    flooredLinearLSPFPL = await FlooredLinearLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
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
      await flooredLinearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound, floorPercentage)
        .send({ from: accounts[0] });

      const setParams = await flooredLinearLSPFPL.methods
        .longShortPairParameters(expiringContractMock.options.address)
        .call();
      assert.equal(setParams.upperBound.toString(), upperBound);
      assert.equal(setParams.lowerBound.toString(), lowerBound);
      assert.equal(setParams.floorPercentage.toString(), floorPercentage);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await flooredLinearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound, floorPercentage)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          flooredLinearLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound, floorPercentage)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          flooredLinearLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, lowerBound, upperBound, floorPercentage)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set floorPercentage above 1", async () => {
      // floorPercentage of 1.5 is invalid.
      assert(
        await didContractThrow(
          flooredLinearLSPFPL.methods
            .setLongShortPairParameters(
              expiringContractMock.options.address,
              upperBound,
              lowerBound,
              toBN(toWei("1.5"))
            )
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          flooredLinearLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, upperBound, lowerBound, floorPercentage)
            .send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await flooredLinearLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, upperBound, lowerBound, floorPercentage)
        .send({ from: accounts[0] });
    });
    it("Lower than lower bound should return floorPercentage", async () => {
      const expiryTokensForCollateral = await flooredLinearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("900"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), floorPercentage.toString());
    });
    it("Higher than upper bound should return 1", async () => {
      const expiryTokensForCollateral = await flooredLinearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("2100"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("1"));
    });
    it("Midway between bounds should return midway between floorPercentage and 1", async () => {
      // (1 - 0.5) / 2 + 0.5 = 0.75.
      const expiryTokensForCollateral = await flooredLinearLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("1500"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.75"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      // expiryPercentLong = (expiryPrice - lowerBound) / (upperBound - lowerBound) *
      // (1 - floorPercentage) + floorPercentage
      for (const price of [toWei("1000"), toWei("1200"), toWei("1400"), toWei("1600"), toWei("1800"), toWei("2000")]) {
        const expiryTokensForCollateral = await flooredLinearLSPFPL.methods
          .percentageLongCollateralAtExpiry(price)
          .call({ from: expiringContractMock.options.address });
        const numerator = toBN(price).sub(toBN(lowerBound));
        const denominator = toBN(upperBound).sub(toBN(lowerBound));
        const coeficient = toBN(toWei("1")).sub(floorPercentage);
        const expectedPrice = numerator.mul(coeficient).div(denominator).add(floorPercentage);
        assert.equal(expiryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
