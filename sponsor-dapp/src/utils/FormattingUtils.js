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
export function formatWithMaxDecimals(num, decimalPlaces) {
  const fixedPrecisionString = Number.parseFloat(num).toFixed(decimalPlaces);

  // Converting to float and back will truncate any extra 0s on the string.
  const truncatedFloat = Number.parseFloat(fixedPrecisionString);
  return truncatedFloat.toString();
}
