import assert from "assert";
import type { BN } from "../types";

// Takes in two big numbers and returns the error between them. using: δ = (observed - expected) / expected
// For example an observed price of 1.2 with an expected price of 1.0 will return (1.2 - 1.0) / 1.0 = 0.20
// This is equivalent of a 20 percent deviation between the numbers.
// Note 1) this can return negative error if the deviation is in a negative direction. 2) Regarding scaling,
// prices are returned in same precision as `scalingFactorBN`.
export const calculateDeviationError = (observedValueBN: BN, expectedValueBN: BN, scalingFactorBN: BN): BN => {
  assert(!expectedValueBN.isZero(), "cannot divide by expectedValue=0");
  // If observedValue is 0, then this always returns -1 * scalingFactor
  return (
    observedValueBN
      .sub(expectedValueBN)
      .mul(scalingFactorBN)
      // By scaling numerator before dividing, we enforce that the "deviation"
      // is returned in the same precision as `scalingFactor`
      .div(expectedValueBN)
  );
};

// Return true if absolute value of deviation between two big numbers is greater than error margin.
export const isDeviationOutsideErrorMargin = (
  observedValueBN: BN,
  expectedValueBN: BN,
  scalingFactorBN: BN,
  errorMarginBN: BN
): boolean => {
  // If the expectedValue is 0, then always return false (i.e. the error is outside the margin)
  // unless the observedValue is also 0. We need to handle when expectedValue is 0 early so that
  // we don't get a divide by 0 error in `calculateDeviationError`.
  if (expectedValueBN.isZero()) {
    return observedValueBN.isZero();
  }

  const deviationBN = calculateDeviationError(observedValueBN, expectedValueBN, scalingFactorBN);
  return deviationBN.abs().gt(errorMarginBN);
};
