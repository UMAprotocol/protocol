const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const argv = require("minimist")(process.argv.slice());

const createExpiringDerivative = async function(callback) {
  try {
    // USAGE: `truffle exec test/scripts/CreateExpiringDerivative.js --identifier <identifier> --network <network>`
    // Assumes that <identifier> is supported by CentralizedOracle.
    // Recommendation is to run this script after migration and `InitializeSystem.js`
    const sponsor = (await web3.eth.getAccounts())[1];

    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(argv.identifier));

    const returnCalculator = await LeveragedReturnCalculator.deployed();
    const priceFeed = await ManualPriceFeed.deployed();
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();

    // Get the latest time/price for identifier
    const { publishTime, price } = await priceFeed.latestPrice(identifierBytes);
    const expiryTime = parseInt(publishTime, 10) + 600;

    // Get the first eligible ERC-20 margin currency
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );
    const whitelist = await marginCurrencyWhitelist.getWhitelist();
    const erc20MarginToken = whitelist.find(address => address !== "0x0000000000000000000000000000000000000000");

    const constructorParams = {
      sponsor,
      defaultPenalty: web3.utils.toWei("0.5", "ether"),
      supportedMove: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: "0", // Must be 0
      disputeDeposit: web3.utils.toWei("0.5", "ether"),
      returnCalculator: returnCalculator.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: expiryTime, // 10 minutes after latest published time
      marginCurrency: erc20MarginToken,
      withdrawLimit: web3.utils.toWei("0.33", "ether"),
      returnType: "0", // Linear
      startingUnderlyingPrice: "0", // Use price feed
      name: `${argv.identifier} expiring`,
      symbol: `${argv.identifier}EXP`
    };
    await tokenizedDerivativeCreator.createTokenizedDerivative(constructorParams, { from: sponsor });

    // Push a price at the expiry time
    const newPrice = price.add(web3.utils.toBN(web3.utils.toWei("0.1")));
    await priceFeed.pushLatestPrice(identifierBytes, expiryTime, newPrice);
  } catch (e) {
    console.error("CreateExpiringDerivative failed:", e);
  }

  callback();
};

module.exports = createExpiringDerivative;
