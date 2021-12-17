// This Util calculates the across realized LP fees. See https://gist.github.com/chrismaree/a713725e4fe96c531c42ed7b629d4a85
// gist for a python implementation of the logic in this file. This implementation is designed to work with both web3.js
// and ethers BNs in the main entry point function calculateRealizedLpFeePct.

import Decimal from "decimal.js";
import { BigNumberish, BN, toBN, toBNWei, fromWei, min, max, fixedPointAdjustment } from "./utils";

// note a similar type exists in the constants file, but are strings only. This is a bit more permissive to allow
// backward compatibility for callers with a rate model defined with bignumbers and not strings.
export interface RateModel {
  UBar: BigNumberish; // denote the utilization kink along the rate model where the slope of the interest rate model changes.
  R0: BigNumberish; // is the interest rate charged at 0 utilization
  R1: BigNumberish; // R_0+R_1 is the interest rate charged at UBar
  R2: BigNumberish; // R_0+R_1+R_2 is the interest rate charged at 100% utilization
}

// Calculate the rate for a 0 sized deposit (infinitesimally small).
export function calculateInstantaneousRate(rateModel: RateModel, utilization: BigNumberish) {
  const beforeKink = min(utilization, rateModel.UBar).mul(rateModel.R1).div(rateModel.UBar);
  const afterKink = max(toBN("0"), toBN(utilization).sub(rateModel.UBar))
    .mul(rateModel.R2)
    .div(toBNWei("1").sub(rateModel.UBar));

  return toBN(rateModel.R0).add(beforeKink).add(afterKink);
}

//  Compute area under curve of the piece-wise linear rate model.
function calculateAreaUnderRateCurve(rateModel: RateModel, utilization: BN) {
  // Area under first piecewise component
  const utilizationBeforeKink = min(utilization, rateModel.UBar);
  const rectangle1Area = utilizationBeforeKink.mul(rateModel.R0).div(fixedPointAdjustment);
  const triangle1Area = toBNWei("0.5")
    .mul(calculateInstantaneousRate(rateModel, utilizationBeforeKink).sub(rateModel.R0))
    .mul(utilizationBeforeKink)
    .div(fixedPointAdjustment)
    .div(fixedPointAdjustment);

  // Area under second piecewise component
  const utilizationAfter = max(toBN("0"), utilization.sub(rateModel.UBar));
  const rectangle2Area = utilizationAfter.mul(toBN(rateModel.R0).add(rateModel.R1)).div(fixedPointAdjustment);
  const triangle2Area = toBNWei("0.5")
    .mul(calculateInstantaneousRate(rateModel, utilization).sub(toBN(rateModel.R0).add(rateModel.R1)))
    .mul(utilizationAfter)
    .div(fixedPointAdjustment)
    .div(fixedPointAdjustment);

  return rectangle1Area.add(triangle1Area).add(rectangle2Area).add(triangle2Area);
}

// converts an APY rate to a one week rate. Uses the Decimal library to take a fractional exponent
function convertApyToWeeklyFee(apy: BN) {
  // R_week = (1 + apy)^(1/52) - 1
  const weeklyFeePct = Decimal.pow(
    new Decimal("1").plus(fromWei(apy)),
    new Decimal("1").dividedBy(new Decimal("52"))
  ).minus(new Decimal("1"));

  // Convert from decimal back to BN, scaled by 1e18.
  return toBN(weeklyFeePct.times(fixedPointAdjustment.toString()).floor().toString());
}

// Calculate the realized yearly LP Fee APY Percent for a given rate model, utilization before and after the deposit.
export function calculateApyFromUtilization(
  rateModel: RateModel,
  utilizationBeforeDeposit: BN,
  utilizationAfterDeposit: BN
) {
  if (utilizationBeforeDeposit.eq(utilizationAfterDeposit)) throw new Error("Deposit cant have zero size");

  // Get the area of [0, utilizationBeforeDeposit] and [0, utilizationAfterDeposit]
  const areaBeforeDeposit = calculateAreaUnderRateCurve(rateModel, utilizationBeforeDeposit);
  const areaAfterDeposit = calculateAreaUnderRateCurve(rateModel, utilizationAfterDeposit);

  const numerator = areaAfterDeposit.sub(areaBeforeDeposit);
  const denominator = utilizationAfterDeposit.sub(utilizationBeforeDeposit);
  return numerator.mul(fixedPointAdjustment).div(denominator);
}

export function calculateRealizedLpFeePct(
  rateModel: RateModel,
  utilizationBeforeDeposit: BigNumberish,
  utilizationAfterDeposit: BigNumberish
) {
  const apy = calculateApyFromUtilization(rateModel, toBN(utilizationBeforeDeposit), toBN(utilizationAfterDeposit));
  return convertApyToWeeklyFee(apy);
}
