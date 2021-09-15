const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const SuccessTokenLongShortPairFinancialProductLibrary = getContract(
  "SuccessTokenLongShortPairFinancialProductLibrary"
);

const LongShortPairMock = getContract("LongShortPairMock");

const { toWei, toBN } = web3.utils;
const strikePrice = toWei("400");
const basePercentage1 = toBN(toWei("0.5"));
const basePercentage2 = toBN(toWei("0.2"));
const collateralPerPair = toBN(toWei("1"));

describe("SuccessTokenLongShortPairFinancialProductLibrary", function () {
  let successTokenLSPFPL;
  let lspMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    successTokenLSPFPL = await SuccessTokenLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
    lspMock = await LongShortPairMock.new(
      "1000000", // _expirationTimestamp
      collateralPerPair // _collateralPerPair
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Cannot set strike price to 0", async () => {
      assert(
        await didContractThrow(
          successTokenLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, 0, basePercentage1)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Cannot set base percentage to 0", async () => {
      assert(
        await didContractThrow(
          successTokenLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, strikePrice, 0)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can set and fetch valid strikes", async () => {
      await successTokenLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, strikePrice, basePercentage1)
        .send({ from: accounts[0] });

      const setParams = await successTokenLSPFPL.methods.longShortPairParameters(lspMock.options.address).call();
      assert.equal(setParams.strikePrice.toString(), strikePrice);
    });
    it("Cannot re-use existing LSP contract address", async () => {
      await successTokenLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, strikePrice, basePercentage1)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          successTokenLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, strikePrice, basePercentage1)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Cannot set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          successTokenLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, strikePrice, basePercentage1)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Cannot compute expiry tokens if parameters have not been set yet", async () => {
      assert(
        await didContractThrow(
          successTokenLSPFPL.methods.percentageLongCollateralAtExpiry(toWei("300")).send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral with base percentage of 0.5", () => {
    beforeEach(async () => {
      await successTokenLSPFPL.methods
        // Set the strike price at 400.
        .setLongShortPairParameters(lspMock.options.address, strikePrice, basePercentage1)
        .send({ from: accounts[0] });
    });
    it("Lower than strike should return 0.5", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        // If the expiry price is below the strike price, the long should be worth 50% of the
        // collateralPerPair, or 0.5.
        .percentageLongCollateralAtExpiry(toWei("300"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.5"));
    });
    it("Expiry price of 0 should return 0.5", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("0"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.5"));
    });
    it("Higher than strike correct value", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        // If the expiry price is above the strike price, the long should be worth 50% of the
        // collateralPerPair, plus 50% * ((expiry price - strike price) / expiry price)
        // With a collateralPerPair of 1, this can be expressed as:
        // 0.5 + (0.5 * (expiryPrice - strikePrice) / expiryPrice)
        // With an expiry price of 500 and strike price of 400, this becomes:
        // 0.5 + (0.5 * (500 - 400) / 500) = 0.6
        .percentageLongCollateralAtExpiry(toWei("500"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.6"));
    });
    it("Should never return a value greater than 1", async () => {
      // Create a massive expiry price. 1e18*1e18. Under all conditions should return less than 1.
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei(toWei("1")))
        .call({ from: lspMock.options.address });
      assert.isTrue(toBN(expiryTokensForCollateral).lt(toBN(toWei("1"))));
    });
  });
  describe("Compute expiry tokens for collateral with base percentage of 0.2", () => {
    beforeEach(async () => {
      await successTokenLSPFPL.methods
        // Set the strike price at 400.
        .setLongShortPairParameters(lspMock.options.address, strikePrice, basePercentage2)
        .send({ from: accounts[0] });
    });
    it("Lower than strike should return 0.2", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        // If the expiry price is below the strike price, the long should be worth 20% of the
        // collateralPerPair, or 0.2.
        .percentageLongCollateralAtExpiry(toWei("300"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Expiry price of 0 should return 0.2", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("0"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Higher than strike correct value", async () => {
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        // If the expiry price is above the strike price, the long should be worth 20% of the
        // collateralPerPair, plus 80% * ((expiry price - strike price) / expiry price)
        // With a collateralPerPair of 1, this can be expressed as:
        // 0.2 + (0.8 * (expiryPrice - strikePrice) / expiryPrice)
        // With an expiry price of 500 and strike price of 400, this becomes:
        // 0.2 + (0.8 * (500 - 400) / 500) = 0.36
        .percentageLongCollateralAtExpiry(toWei("500"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.36"));
    });
    it("Should never return a value greater than 1", async () => {
      // Create a massive expiry price. 1e18*1e18. Under all conditions should return less than 1.
      const expiryTokensForCollateral = await successTokenLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei(toWei("1")))
        .call({ from: lspMock.options.address });
      assert.isTrue(toBN(expiryTokensForCollateral).lt(toBN(toWei("1"))));
    });
  });
});
