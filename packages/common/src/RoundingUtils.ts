import Web3 from "web3";
import { BigNumber } from "bignumber.js";
import { BN } from "./types";

const { toBN } = Web3.utils;

// Takes inputAmount scaled up to inputDecimals, scales it down, rounds to roundingPrecision decimals
// and returns the rounded amount scaled up to the same inputDecimals.
// If roundingPrecision is negative then round to the nearest 10 to the power of absolute roundingPrecision value.
export function roundToDecimal(inputAmount: BN, inputDecimals: number, roundingPrecision: number): BN {
  if (inputDecimals < 0) throw new Error("decimal precision should be non-negative");

  return toBN(
    new BigNumber(inputAmount.toString())
      .shiftedBy(roundingPrecision - inputDecimals)
      .decimalPlaces(0)
      .shiftedBy(inputDecimals - roundingPrecision)
      .toFixed()
  );
}
