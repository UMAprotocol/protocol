const BigNumber = require("bignumber.js");

export function formatDate(timestampInSeconds, web3) {
  return new Date(
    parseInt(
      web3.utils
        .toBN(timestampInSeconds)
        .muln(1000)
        .toString(),
      10
    )
  ).toString();
}

// formatWei converts a string or BN instance from Wei to Ether, e.g., 1e19 -> 10.
export function formatWei(num, web3) {
  // Web3's `fromWei` function doesn't work on BN objects in minified mode (e.g.,
  // `web3.utils.isBN(web3.utils.fromBN("5"))` is false), so we use a workaround where we always pass in strings.
  // See https://github.com/ethereum/web3.js/issues/1777.
  return web3.utils.fromWei(num.toString());
}

// Formats the input to round to decimalPlaces number of decimals.
export function formatWithMaxDecimals(num, decimalPlaces, roundUp) {
  if (roundUp) {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_UP });
  } else {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_DOWN });
  }

  const fullPrecisionFloat = BigNumber(num);

  // Convert back to BN to truncate any trailing 0s that the toFixed() output would print.
  const fixedPrecisionFloat = BigNumber(fullPrecisionFloat.toFixed(decimalPlaces));
  return fixedPrecisionFloat.toString();
}
