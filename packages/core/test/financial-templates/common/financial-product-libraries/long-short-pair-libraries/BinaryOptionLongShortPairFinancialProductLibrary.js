const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const BinaryOptionLongShortPairFinancialProductLibrary = getContract(
  "BinaryOptionLongShortPairFinancialProductLibrary"
);

// helper contracts. To test LSP libraries we simply need a financial contract with an `expirationTimestamp` method.
const ExpiringContractMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("3000"));

describe("BinaryOptionLongShortPairFinancialProductLibrary", function () {
  let binaryLSPFPL;
  let expiringContractMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    binaryLSPFPL = await BinaryOptionLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
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
      await binaryLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      const setParams = await binaryLSPFPL.methods.longShortPairParameters(expiringContractMock.options.address).call();
      assert.isTrue(setParams.isSet);
      assert.equal(setParams.strikePrice.toString(), strikePrice);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await binaryLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          binaryLSPFPL.methods
            .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          binaryLSPFPL.methods.setLongShortPairParameters(ZERO_ADDRESS, strikePrice).send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await binaryLSPFPL.methods
        .setLongShortPairParameters(expiringContractMock.options.address, strikePrice)
        .send({ from: accounts[0] });
    });
    it("Lower than lower bound should return 0", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("2500"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0"));
    });
    it("equal to upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("3000"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });
    it("Higher than upper bound should return 1", async () => {
      const expiraryTokensForCollateral = await binaryLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("3500"))
        .call({ from: expiringContractMock.options.address });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });

    it("Arbitrary price between bounds should return correctly", async () => {
      for (const price of [toWei("1000"), toWei("2000"), toWei("3000"), toWei("4000"), toWei("5000"), toWei("10000")]) {
        const expiraryTokensForCollateral = await binaryLSPFPL.methods
          .percentageLongCollateralAtExpiry(price)
          .call({ from: expiringContractMock.options.address });
        const expectedPrice = toBN(price).gte(toBN(strikePrice)) ? toWei("1") : toWei("0");

        assert.equal(expiraryTokensForCollateral.toString(), expectedPrice.toString());
      }
    });
  });
});
