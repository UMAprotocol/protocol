import BN from "bn.js";
// const { toBN, toWei } = Web3.utils;

const toBN = (number: string | number) => new BN(number.toString());
const toWei = (number: string | number) => new BN(number.toString()).mul(new BN("1e18")).toString();
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());
const fixedPointAdjustment = toBNWei("1");

export interface RateModel {
  UBar: BN; // denote the utilization kink where the slope of the interest rate model changes.
  R0: BN; // is the interest rate charged at 0 utilization
  R1: BN; // R_0+R_1 is the interest rate charged at UBar
  R2: BN; // R_0+R_1+R_2 is the interest rate charged at 100% utilization
}

// Calculate the rate for a 0 sized deposit (infinitesimally small).
function calculateInstantaneousRate(rateModel: RateModel, utilization: BN) {
  const piece1 = BN.min(utilization, rateModel.UBar).mul(rateModel.R1).div(rateModel.UBar);
  const piece2 = BN.max(toBN("0"), utilization.sub(rateModel.UBar))
    .mul(rateModel.R2)
    .div(toBNWei("1").sub(rateModel.UBar));

  return rateModel.R0.add(piece1).add(piece2);
}

//  Compute area under curve of the piece-wise linear rate model.
function calculateAreaUnderRateCurve(rateModel: RateModel, utilization: BN) {
  // Area under first piecewise component
  const utilizationTilda1 = BN.min(utilization, rateModel.UBar);
  const rectangle1Area = utilizationTilda1.mul(rateModel.R0).div(fixedPointAdjustment);
  const triangle1Area = toBNWei("0.5")
    .mul(calculateInstantaneousRate(rateModel, utilizationTilda1).sub(rateModel.R0))
    .mul(utilizationTilda1)
    .div(fixedPointAdjustment)
    .div(fixedPointAdjustment);

  // Area under second piecewise component
  const utilizationTilda2 = BN.max(toBN("0"), utilization.sub(rateModel.UBar));
  const rectangle2Area = utilizationTilda2.mul(rateModel.R0.add(rateModel.R1)).div(fixedPointAdjustment);
  const triangle2Area = toBNWei("0.5")
    .mul(calculateInstantaneousRate(rateModel, utilization).sub(rateModel.R0.add(rateModel.R1)))
    .mul(utilizationTilda2)
    .div(fixedPointAdjustment)
    .div(fixedPointAdjustment);

  return rectangle1Area.add(triangle1Area).add(rectangle2Area).add(triangle2Area);
}

// Calculate the realized LP Fee Percent for a given rate model, utilization before and after the deposit.
export function calculateRealizedLpFeePct(
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
