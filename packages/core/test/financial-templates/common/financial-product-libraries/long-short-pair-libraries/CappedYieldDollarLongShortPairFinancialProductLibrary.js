const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const CappedYieldDollarLongShortPairFinancialProductLibrary = getContract(
  "CappedYieldDollarLongShortPairFinancialProductLibrary"
);

const LongShortPairMock = getContract("LongShortPairMock");

// Note: Assume that the notional value of the bond is 100.
const { toWei, toBN } = web3.utils;
const lowPriceRange = toBN(toWei("10"));
const collateralPerPair = toBN(toWei("10"));

describe("CappedYieldDollarLongShortPairFinancialProductLibrary", function () {
  let cappedYieldDollarLSPFPL;
  let lspMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    cappedYieldDollarLSPFPL = await CappedYieldDollarLongShortPairFinancialProductLibrary.new().send({
      from: accounts[0],
    });
    lspMock = await LongShortPairMock.new(
      "1000000", // _expirationTimestamp
      collateralPerPair // _collateralPerPair
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid values", async () => {
      await cappedYieldDollarLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, lowPriceRange)
        .send({ from: accounts[0] });

      const setLowPriceRange = await cappedYieldDollarLSPFPL.methods.lowPriceRanges(lspMock.options.address).call();
      assert.equal(setLowPriceRange.toString(), lowPriceRange);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await cappedYieldDollarLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, lowPriceRange)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          cappedYieldDollarLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, lowPriceRange)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          cappedYieldDollarLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, lowPriceRange)
            .send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await cappedYieldDollarLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, lowPriceRange)
        .send({ from: accounts[0] });
    });
    it("Lower than low price range should return 1 (long side is short put option)", async () => {
      // If the price is lower than the low price range then the max payout per each long token is hit at the full
      // collateralPerPair. i.e each short token is worth 0*collateralPerPair and each long token is worth 1*collateralPerPair.
      const expiryTokensForCollateral = await cappedYieldDollarLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("9"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("1"));
    });
    it("Above the low price range should return long worth bond notional (long side is long yield dollar)", async () => {
      // If the price is above the low price range then the payout is simply that of a yield dollar. i.e every
      // long token is worth the bond notional of 100. At a price of 20 we are between the bounds. Each long should be worth
      // 100 so there should be 100/20=5 UMA per long token. As each collateralPerPair is worth 10, expiryPercentLong should
      // be 5/10=0.5, thereby allocating half to the long and half to the short.
      const expiryTokensForCollateral1 = await cappedYieldDollarLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("20"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral1.toString(), toWei("0.5"));

      // Equally, at a price of 40 each long should still be worth 100 so there should be 100/40=2.5 UMA per long. As
      // each collateralPerPair=10 expiryPercentLong should be 2.5/10=0.25, thereby allocating 25% to long and the remaining to short.
      const expiryTokensForCollateral2 = await cappedYieldDollarLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("40"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral2.toString(), toWei("0.25"));
    });
  });
});
