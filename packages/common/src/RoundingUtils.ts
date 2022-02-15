import Web3 from "web3";
import { BigNumber } from "bignumber.js";
import { BN } from "./types";

const { toBN } = Web3.utils;

/**
 * @title Utility function for rounding BN values.
 * @param {BN} inputAmount that is scaled up.
 * @param {Number} inputDecimals specifies decimal scaling for processed value.
 * @param {Number} roundingPrecision specifies amount of decimals left after rounding.
 *      Negative value would round to the nearest 10 to the power of absolute roundingPrecision value.
 * @param {RoundingMode} roundingMode is optional rounding mode documented in
 *      https://mikemcl.github.io/bignumber.js/#constructor-properties
 */
export function roundToDecimal(
  inputAmount: BN,
  inputDecimals: number,
  roundingPrecision: number,
  roundingMode: BigNumber.RoundingMode = BigNumber.ROUND_HALF_UP
): BN {
  if (inputDecimals < 0) throw new Error("decimal precision should be non-negative");

  return toBN(
    new BigNumber(inputAmount.toString())
      .shiftedBy(roundingPrecision - inputDecimals)
      .decimalPlaces(0, roundingMode)
      .shiftedBy(inputDecimals - roundingPrecision)
      .toFixed()
  );
}
