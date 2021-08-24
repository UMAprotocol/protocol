const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const RangeBondLongShortPairFinancialProductLibrary = getContract("RangeBondLongShortPairFinancialProductLibrary");

const LongShortPairMock = getContract("LongShortPairMock");

const { toWei, toBN, BN } = web3.utils;
const bondNotional = toBN(toWei("100"));
const lowPriceRange = toBN(toWei("10"));
const highPriceRange = toBN(toWei("50"));
const collateralPerPair = toBN(toWei("10"));

describe("RangeBondLongShortPairFinancialProductLibrary", function () {
  let rangeBondLSPFPL;
  let lspMock;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
  });

  beforeEach(async () => {
    rangeBondLSPFPL = await RangeBondLongShortPairFinancialProductLibrary.new().send({ from: accounts[0] });
    lspMock = await LongShortPairMock.new(
      "1000000", // _expirationTimestamp
      collateralPerPair // _collateralPerPair
    ).send({ from: accounts[0] });
  });
  describe("Long Short Pair Parameterization", () => {
    it("Can set and fetch valid values", async () => {
      await rangeBondLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, highPriceRange, lowPriceRange)
        .send({ from: accounts[0] });

      const setParams = await rangeBondLSPFPL.methods.longShortPairParameters(lspMock.options.address).call();
      assert.equal(setParams.lowPriceRange.toString(), lowPriceRange);
      assert.equal(setParams.highPriceRange.toString(), highPriceRange);
    });
    it("Can not re-use existing LSP contract address", async () => {
      await rangeBondLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, highPriceRange, lowPriceRange)
        .send({ from: accounts[0] });

      // Second attempt should revert.
      assert(
        await didContractThrow(
          rangeBondLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, highPriceRange, lowPriceRange)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          rangeBondLSPFPL.methods
            .setLongShortPairParameters(lspMock.options.address, lowPriceRange, highPriceRange)
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set invalid LSP contract address", async () => {
      // LSP Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          rangeBondLSPFPL.methods
            .setLongShortPairParameters(ZERO_ADDRESS, highPriceRange, lowPriceRange)
            .send({ from: accounts[0] })
        )
      );
    });
  });
  describe("Compute expiry tokens for collateral", () => {
    beforeEach(async () => {
      await rangeBondLSPFPL.methods
        .setLongShortPairParameters(lspMock.options.address, highPriceRange, lowPriceRange)
        .send({ from: accounts[0] });
    });
    it("Lower than low price range should return 1 (long side is short put option)", async () => {
      // If the price is lower than the low price range then the max payout per each long token is hit at the full
      // collateralPerPair. i.e each short token is worth 0*collateralPerPair and each long token is worth 1*collateralPerPair.
      const expiryTokensForCollateral = await rangeBondLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("9"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("1"));
    });
    it("Higher than upper bound should return 0.2 (long side is long call option)", async () => {
      // If the price is larger than the high price range then the long tokens are equal fixed amount of notional/highPriceRange
      // Considering the long token to compute the expiryPercentLong (notional/highPriceRange)/collateralPerPair=(100/50)/10=0.2.
      // i.e each short token is worth 0.8* collateralPerPair = 8 tokens and each long token is worth 0.2*collateralPerPair=2.
      const expiryTokensForCollateral = await rangeBondLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("60"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Midway between bounds should return long worth bond notional (long side is long yield dollar)", async () => {
      // If the price is between the low and high price ranges then the payout is simply that of a yield dollar. i.e every
      // long token is worth the bond notional of 100. At a price of 20 we are between the bounds. Each long should be worth
      // 100 so there should be 100/20=5 UMA per long token. As each collateralPerPair is worth 10, expiryPercentLong should
      // be 10/5=0.5, thereby allocating half to the long and half to the short.
      const expiryTokensForCollateral1 = await rangeBondLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("20"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral1.toString(), toWei("0.5"));

      // Equally, at a price of 40 each long should still be worth 100 so there should be 100/40=2.5 UMA per long. As
      // each collateralPerPair=10 expiryPercentLong should be 10/2.5=0.25, thereby allocating 25% to long and the remaining to short.
      const expiryTokensForCollateral2 = await rangeBondLSPFPL.methods
        .percentageLongCollateralAtExpiry(toWei("20"))
        .call({ from: lspMock.options.address });
      assert.equal(expiryTokensForCollateral2.toString(), toWei("0.5"));
    });

    it("Arbitrary price should return correctly", async () => {
      // Value of long token: T = min(N/P,N/R1) + max((N/R2*(P-R2))/P),0)
      // expected payout is T/collateralPerPair. We can compute the exact numerical amount for a set of input prices
      // and double check the payout maps to what is expected.

      const fixedPointAdjustment = toBN(toWei("1"));

      // Input a range of prices and check the library returns the expected value. The equation below uses the financial
      // form of the range bond equation where as the library uses an algebraic simplification of this equation. This
      // test validates the correct mapping between these two forms.
      for (const price of [toWei("5.555"), toWei("11"), toWei("33"), toWei("55"), toWei("66"), toWei("111")]) {
        const expiryTokensForCollateral = await rangeBondLSPFPL.methods
          .percentageLongCollateralAtExpiry(price)
          .call({ from: lspMock.options.address });
        //
        const term1 = BN.min(
          toBN(bondNotional).mul(fixedPointAdjustment).div(toBN(price)),
          toBN(bondNotional).mul(fixedPointAdjustment).div(toBN(lowPriceRange))
        );

        const term2 = BN.max(
          toBN(bondNotional)
            .div(toBN(highPriceRange))
            .mul(fixedPointAdjustment)
            .mul(toBN(price).sub(toBN(highPriceRange)))
            .div(toBN(price))
            .addn(1),
          toBN("0")
        );

        const longTokenRedemptionInCollateral = term1.add(term2);
        const expectedExpiryTokensForCollateral = longTokenRedemptionInCollateral
          .mul(fixedPointAdjustment)
          .div(collateralPerPair);

        assert.equal(expiryTokensForCollateral.toString(), expectedExpiryTokensForCollateral.toString());
      }
    });
  });
});
