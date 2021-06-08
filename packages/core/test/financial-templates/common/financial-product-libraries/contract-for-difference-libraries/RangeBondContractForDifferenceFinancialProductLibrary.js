const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const RangeBondContractForDifferenceFinancialProductLibrary = artifacts.require(
  "RangeBondContractForDifferenceFinancialProductLibrary"
);

const ContractForDifferenceMock = artifacts.require("ContractForDifferenceMock");

const { toWei, toBN, BN } = web3.utils;
const bondNotional = toBN(toWei("100"));
const lowPriceRange = toBN(toWei("10"));
const highPriceRange = toBN(toWei("50"));
const collateralPerPair = toBN(toWei("10"));

contract("RangeBondContractForDifferenceFinancialProductLibrary", function () {
  let rangeBondCFDFPL;
  let cfdMock;

  beforeEach(async () => {
    rangeBondCFDFPL = await RangeBondContractForDifferenceFinancialProductLibrary.new();
    cfdMock = await ContractForDifferenceMock.new(
      "1000000", // _expirationTimestamp
      collateralPerPair // _collateralPerPair
    );
  });
  describe("Contract For diffrence Paramaterization", () => {
    it("Can set and fetch valid values", async () => {
      await rangeBondCFDFPL.setContractForDifferenceParameters(
        cfdMock.address,
        bondNotional,
        highPriceRange,
        lowPriceRange
      );

      const setParams = await rangeBondCFDFPL.contractForDifferenceParameters(cfdMock.address);
      assert.equal(setParams.bondNotional.toString(), bondNotional);
      assert.equal(setParams.lowPriceRange.toString(), lowPriceRange);
      assert.equal(setParams.highPriceRange.toString(), highPriceRange);
    });
    it("Can not re-use existing CFD contract address", async () => {
      await rangeBondCFDFPL.setContractForDifferenceParameters(
        cfdMock.address,
        bondNotional,
        highPriceRange,
        lowPriceRange
      );

      // Second attempt should revert.
      assert(
        await didContractThrow(
          rangeBondCFDFPL.setContractForDifferenceParameters(
            cfdMock.address,
            bondNotional,
            lowPriceRange,
            highPriceRange
          )
        )
      );
    });
    it("Can not set invalid bounds", async () => {
      // upper bound larger than lower bound by swapping upper and lower
      assert(
        await didContractThrow(
          rangeBondCFDFPL.setContractForDifferenceParameters(cfdMock.address, lowPriceRange, highPriceRange)
        )
      );
    });
    it("Can not set invalid CFD contract address", async () => {
      // CFD Address must implement the `expirationTimestamp method.
      assert(
        await didContractThrow(
          rangeBondCFDFPL.setContractForDifferenceParameters(ZERO_ADDRESS, bondNotional, highPriceRange, lowPriceRange)
        )
      );
    });
  });
  describe("Compute expirary tokens for collateral", () => {
    beforeEach(async () => {
      await rangeBondCFDFPL.setContractForDifferenceParameters(
        cfdMock.address,
        bondNotional,
        highPriceRange,
        lowPriceRange
      );
    });
    it("Lower than low price range should return 1 (long side is short put option)", async () => {
      // If the price is lower than the low price range then the max payout per each long token is hit at the full
      // collateralPerPair. i.e each short token is worth 0*collateralPerPair and each long token is worth 1*collateralPerPair.
      const expiraryTokensForCollateral = await rangeBondCFDFPL.computeExpiraryTokensForCollateral.call(toWei("9"), {
        from: cfdMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("1"));
    });
    it("Higher than upper bound should return 0.2 (long side is long call option)", async () => {
      // If the price is larger than the high price range then the long tokens are equal fixed amount of notional/highPriceRange
      // Considering the long token to compute the expiryPercentLong (notional/highPriceRange)/collateralPerpair=(100/50)/10=0.2.
      // i.e each short token is worth 0.8* collateralPerpair = 8 tokens and each long token is worth 0.2*collateralPerpair=2.
      const expiraryTokensForCollateral = await rangeBondCFDFPL.computeExpiraryTokensForCollateral.call(toWei("60"), {
        from: cfdMock.address,
      });
      assert.equal(expiraryTokensForCollateral.toString(), toWei("0.2"));
    });
    it("Midway between bounds should return long worth bond notional (long side is long yield dollar)", async () => {
      // If the price is between the low and high price ranges then the payout is simply that of a yield dollar. i.e every
      // long token is worth the bond notional of 100. At a price of 20 we are between the bounds. Each long should be worth
      // 100 so there should be 100/20=5 UMA per long token. As each collateralPerpair is worth 10, expiryPercentLong should
      // be 10/5=0.5, thereby allocating half to the long and half to the short.
      const expiraryTokensForCollateral1 = await rangeBondCFDFPL.computeExpiraryTokensForCollateral.call(toWei("20"), {
        from: cfdMock.address,
      });
      assert.equal(expiraryTokensForCollateral1.toString(), toWei("0.5"));

      // Equally, at a price of 40 each long should still be worth 100 so there should be 100/40=2.5 UMA per long. As
      // each collateralPerpair=10 expiryPercentLong should be 10/2.5=0.25, thereby allocating 25% to long and the remaining to short.
      const expiraryTokensForCollateral2 = await rangeBondCFDFPL.computeExpiraryTokensForCollateral.call(toWei("20"), {
        from: cfdMock.address,
      });
      assert.equal(expiraryTokensForCollateral2.toString(), toWei("0.5"));
    });

    it("Arbitary price should return correctly", async () => {
      // Value of long token: T = min(N/P,N/R1) + max((N/R2*(P-R2))/P),0)
      // expected payout is T/collateralPerPair. We can compute the exact numerical amount for a set of input prices
      // and double check the payout maps to what is expected.

      const fixedPointAdjustment = toBN(toWei("1"));

      for (const price of [toWei("5"), toWei("10"), toWei("30"), toWei("50"), toWei("60"), toWei("100")]) {
        const expiraryTokensForCollateral = await rangeBondCFDFPL.computeExpiraryTokensForCollateral.call(price, {
          from: cfdMock.address,
        });
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
        const expectedExpiraryTokensForCollateral = longTokenRedemptionInCollateral
          .mul(fixedPointAdjustment)
          .div(collateralPerPair);

        assert.equal(expiraryTokensForCollateral.toString(), expectedExpiraryTokensForCollateral.toString());
      }
    });
  });
});
