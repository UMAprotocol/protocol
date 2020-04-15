const networkUtils = require("../common/PublicNetworks");

const BigNumber = require("bignumber.js");

const formatDate = (timestampInSeconds, web3) => {
  return new Date(
    parseInt(
      web3.utils
        .toBN(timestampInSeconds)
        .muln(1000)
        .toString(),
      10
    )
  ).toString();
};

// formatWei converts a string or BN instance from Wei to Ether, e.g., 1e19 -> 10.
const formatWei = (num, web3) => {
  // Web3's `fromWei` function doesn't work on BN objects in minified mode (e.g.,
  // `web3.utils.isBN(web3.utils.fromBN("5"))` is false), so we use a workaround where we always pass in strings.
  // See https://github.com/ethereum/web3.js/issues/1777.
  return web3.utils.fromWei(num.toString());
};

// Formats the input to round to decimalPlaces number of decimals.
const formatWithMaxDecimals = (num, decimalPlaces, roundUp) => {
  if (roundUp) {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_UP });
  } else {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_DOWN });
  }

  const fullPrecisionFloat = BigNumber(num);

  // Convert back to BN to truncate any trailing 0s that the toFixed() output would print.
  const fixedPrecisionFloat = BigNumber(fullPrecisionFloat).toFixed(decimalPlaces);
  return fixedPrecisionFloat.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const createFormatFunction = (web3, numDisplayedDecimals) => {
  return valInWei => formatWithMaxDecimals(formatWei(valInWei, web3), numDisplayedDecimals, false);
};

// generate a etherscan link prefix
function createEtherscanLinkFromtx(web3) {
  // Construct etherscan link based on network
  const networkId = web3.networkId;
  let url;
  if (networkUtils[networkId]) {
    url = `${networkUtils[networkId].etherscan}`;
  } else {
    // Default to mainnet, even though it won't work for ganache runs.
    url = "https://etherscan.io/";
  }
  return url;
}

// Convert either an address or transaction to a shorter version.
// 0x772871a444c6e4e9903d8533a5a13101b74037158123e6709470f0afbf6e7d94 -> 0x7787...7d94
function createShortHexString(hex) {
  return hex.substring(0, 5) + "..." + hex.substring(hex.length - 6, hex.length - 1);
}

// Take in either a transaction or an account and generate an etherscan link for the corresponding
// network formatted in markdown.
function createEtherscanLinkMarkdown(web3, hex) {
  let shortURLString = createShortHexString(hex);

  // Transaction hash
  if (hex.length == 66) {
    return `<${createEtherscanLinkFromtx(web3, networkUtils)}tx/${hex}|${shortURLString}>`;
  }
  // Account
  else if (hex.length == 42) {
    return `<${createEtherscanLinkFromtx(web3, networkUtils)}address/${hex}|${shortURLString}>`;
  }
}

module.exports = {
  formatDate,
  formatWei,
  formatWithMaxDecimals,
  createFormatFunction,
  createEtherscanLinkFromtx,
  createShortHexString,
  createEtherscanLinkMarkdown
};
