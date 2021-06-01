const { PublicNetworks: networkUtils } = require("./PublicNetworks");

const BigNumber = require("bignumber.js");
const moment = require("moment");
const assert = require("assert");
const { formatFixed, parseFixed } = require("@ethersproject/bignumber");

// Apply settings to BigNumber.js library.
// Note: ROUNDING_MODE is set to round ceiling so we send at least enough collateral to create the requested tokens.
// Note: RANGE is set to 500 so values don't overflow to infinity until they hit +-1e500.
// Note: EXPONENTIAL_AT is set to 500 to keep BigNumber from using exponential notation until the numbers hit
// +-1e500.
BigNumber.set({ ROUNDING_MODE: 2, RANGE: 500, EXPONENTIAL_AT: 500 });

// Given a timestamp in seconds, returns the date in the format: "MM/DD/YYYY"
const formatDateShort = (timestampInSeconds) => {
  const date = moment.unix(parseInt(Number(timestampInSeconds)));
  return date.format("MM/DD/YYYY");
};

const formatDate = (timestampInSeconds, web3) => {
  return new Date(parseInt(web3.utils.toBN(timestampInSeconds).muln(1000).toString(), 10)).toString();
};

const formatHours = (seconds, decimals = 2) => {
  // 3600 seconds in an hour.
  return (seconds / 3600).toFixed(decimals);
};

// formatWei converts a string or BN instance from Wei to Ether, e.g., 1e19 -> 10.
const formatWei = (num, web3) => {
  // Web3's `fromWei` function doesn't work on BN objects in minified mode (e.g.,
  // `web3.utils.isBN(web3.utils.fromBN("5"))` is false), so we use a workaround where we always pass in strings.
  // See https://github.com/ethereum/web3.js/issues/1777.
  return web3.utils.fromWei(num.toString());
};

// Formats the input to round to decimalPlaces number of decimals if the number has a magnitude larger than 1 and fixes
// precision to minPrecision if the number has a magnitude less than 1.
const formatWithMaxDecimals = (num, decimalPlaces, minPrecision, roundUp, showSign) => {
  if (roundUp) {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_UP });
  } else {
    BigNumber.set({ ROUNDING_MODE: BigNumber.ROUND_DOWN });
  }

  const fullPrecisionFloat = BigNumber(num);
  const positiveSign = showSign && fullPrecisionFloat.gt(0) ? "+" : "";
  let fixedPrecisionFloat;
  // Convert back to BN to truncate any trailing 0s that the toFixed() output would print. If the number is equal to or larger than
  // 1 then truncate to `decimalPlaces` number of decimal places. EG 999.999 -> 999.99 with decimalPlaces=2 If the number
  // is less than 1 then truncate to minPrecision precision. EG: 0.0022183471 -> 0.002218 with minPrecision=4
  if (fullPrecisionFloat.abs().gte(BigNumber(1))) {
    fixedPrecisionFloat = BigNumber(fullPrecisionFloat).toFixed(decimalPlaces).toString();
  } else {
    fixedPrecisionFloat = BigNumber(fullPrecisionFloat).toPrecision(minPrecision).toString();
  }
  // This puts commas in the thousands places, but only before the decimal point.
  const fixedPrecisionFloatParts = fixedPrecisionFloat.split(".");
  fixedPrecisionFloatParts[0] = fixedPrecisionFloatParts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return positiveSign + fixedPrecisionFloatParts.join(".");
};

const createFormatFunction = (web3, numDisplayedDecimals, minDisplayedPrecision, showSign = false, decimals = 18) => {
  return (valInWei) =>
    formatWithMaxDecimals(
      formatWei(ConvertDecimals(decimals, 18, web3)(valInWei), web3),
      numDisplayedDecimals,
      minDisplayedPrecision,
      false,
      showSign
    );
};

// Generate an etherscan link prefix. If a networkId is provided then the URL will point to this network. Else, assume mainnet.
function createEtherscanLinkFromtx(networkId) {
  // Construct etherscan link based on network
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
function createEtherscanLinkMarkdown(hex, networkId = 1) {
  if (hex.substring(0, 2) != "0x") return null;
  let shortURLString = createShortHexString(hex);
  // Transaction hash
  if (hex.length == 66) return `<${createEtherscanLinkFromtx(networkId)}tx/${hex}|${shortURLString}>`;
  // Account
  else if (hex.length == 42) return `<${createEtherscanLinkFromtx(networkId)}address/${hex}|${shortURLString}>`;
}

function addSign(number) {
  if (Number(number) > 0) {
    return `+${number}`;
  } else {
    // Number strings already print the '-' sign for negative numbers.
    return `${number}`;
  }
}

// Take an amount based on fromDecimals and convert it to an amount based on toDecimals. For example 100 usdt = 100e6,
// with 6 decimals. If you wanted to convert this to a base 18 decimals you would get:
// convertDecimals(6,18)(100000000)  => 100000000000000000000 = 100e18.
// Returns a BigNumber you will need to call toString on
// fromDecimals: number - decimal value of amount
// toDecimals: number - decimal value to convert to
// web3: web3 object to get a big number function.
// return => (amount:string)=>BN
const ConvertDecimals = (fromDecimals, toDecimals, web3) => {
  assert(fromDecimals >= 0, "requires fromDecimals as an integer >= 0");
  assert(toDecimals >= 0, "requires toDecimals as an integer >= 0");
  assert(web3, "requires web3 instance");
  // amount: string, BN, number - integer amount in fromDecimals smallest unit that want to convert toDecimals
  // returns: BN with toDecimals in smallest unit
  return (amount) => {
    amount = web3.utils.toBN(amount);
    if (amount.isZero()) return amount;
    const diff = fromDecimals - toDecimals;
    if (diff == 0) return amount;
    if (diff > 0) return amount.div(web3.utils.toBN("10").pow(web3.utils.toBN(diff.toString())));
    return amount.mul(web3.utils.toBN("10").pow(web3.utils.toBN((-1 * diff).toString())));
  };
};

module.exports = {
  formatDateShort,
  formatDate,
  formatHours,
  formatWei,
  formatWithMaxDecimals,
  createFormatFunction,
  createEtherscanLinkFromtx,
  createShortHexString,
  createEtherscanLinkMarkdown,
  addSign,
  formatFixed,
  parseFixed,
  ConvertDecimals,
};
