const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const SimpleSuccessTokenLongShortPairFinancialProductLibrary = getContract(
  "SimpleSuccessTokenLongShortPairFinancialProductLibrary"
);

const LongShortPairMock = getContract("LongShortPairMock");

const { toWei, toBN } = web3.utils;
const strikePrice = toWei("400");
const collateralPerPair = toBN(toWei("1"));

describe("SimpleSuccessTokenLongShortPairFinancialProductLibrary", function () {
  let simpleSuccessTokenLSPFPL;
  let lspMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    simpleSuccessTokenLSPFPL = await SimpleSuccessTokenLongShortPairFinancialProductLibrary.new().send({
      from: accounts[0],
    });
    lspMock = await LongShortPairMock.new(
      "1000000", // _expirationTimestamp
      collateralPerPair // _collateralPerPair
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid strikes", async () => {
      await simpleSuccessTokenLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      const setStrike = await simpleSuccessTokenLSPFPL.methods
        .longShortPairStrikePrices(lspMock.options.address)
        .call();
      assert.equal(setStrike.toString(), strikePrice);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await simpleSuccessTokenLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, strikePrice)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          simpleSuccessTokenLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, strikePrice)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          simpleSuccessTokenLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, strikePrice)
            .send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await simpleSuccessTokenLSPFPL.methods
        // Set the strike price at 400.
        .setLongShortPairParameters(lspMock.options.address, strikePrice)
        .send({ from: accounts[0] });
    });
    it("Lower than strike should return 0.5", async () => {
      const expiryTokensForCollateral = await simpleSuccessTokenLSPFPL.methods
        // If the expiry price is below the strike price, the long should be worth 50% of the
        // collateralPerPair, or 0.5.
        .percentageLongCollateralAtExpiry(toWei("300"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.5"));
    });
    it("Higher than strike correct value", async () => {
      const expiryTokensForCollateral = await simpleSuccessTokenLSPFPL.methods
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
      const expiryTokensForCollateral = await simpleSuccessTokenLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei(toWei("1")))
        .call({ from: lspMock.options.address });
      assert.isTrue(toBN(expiryTokensForCollateral).lt(toBN(toWei("1"))));
    });
  });
});
