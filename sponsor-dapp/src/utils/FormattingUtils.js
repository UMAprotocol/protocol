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
  const fullPrecisionFloat = Number.parseFloat(num);
  let fixedPrecisionFloat = Number.parseFloat(fullPrecisionFloat.toFixed(decimalPlaces));

  // Get the smallest representable unit in our fixed precision representation.
  const smallestUnit = Math.pow(10, -decimalPlaces);

  // Take the fixed precision float and ensure it's rounded the correct way.
  // Note: this is necessary because toFixed() does rounding of its own.
  if (roundUp && fixedPrecisionFloat < fullPrecisionFloat) {
    fixedPrecisionFloat += smallestUnit;
  } else if (!roundUp && fixedPrecisionFloat > fullPrecisionFloat) {
    fixedPrecisionFloat -= smallestUnit;
  }

  return fixedPrecisionFloat.toString();
}
