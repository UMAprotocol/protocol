const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

// Deploys a TokenizedDerivative. Used for deploying a contract to Ganache for local testing.
const initializeSystem = async function(callback) {
  try {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("ETH/USD"));
    const deployedRegistry = await Registry.deployed();
    const deployedCentralizedOracle = await CentralizedOracle.deployed();
    const deployedCentralizedStore = await CentralizedStore.deployed();
    const deployedManualPriceFeed = await ManualPriceFeed.deployed();
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const noLeverageCalculator = await LeveragedReturnCalculator.deployed();
    const returnCalculatorWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.returnCalculatorWhitelist()
    );

    await deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    await deployedManualPriceFeed.setCurrentTime(100000);
    const price = web3.utils.toWei("1", "ether");
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + 60;
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);

    await deployedRegistry.addDerivativeCreator(tokenizedDerivativeCreator.address);

    // To distinguish from the "owner", i.e., UMA which is accounts[0].
    const sponsor = (await web3.eth.getAccounts())[1];

    // TODO(ptare): Take some of these parameters from the command line, so that various TokenizedDerivatives can be
    // deployed without changing this script every time.
    const defaultConstructorParams = {
      sponsor: sponsor,
      defaultPenalty: web3.utils.toWei("0.5", "ether"),
      supportedMove: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
      disputeDeposit: web3.utils.toWei("0.5", "ether"),
      returnCalculator: noLeverageCalculator.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: 0, // Perpetual
      marginCurrency: "0x0000000000000000000000000000000000000000", // ETH
      withdrawLimit: web3.utils.toWei("0.33", "ether"),
      returnType: "1", // Compound
      startingUnderlyingPrice: "0", // Use price feed
      name: "namenamename",
      symbol: "symbolsymbol"
    };
    await tokenizedDerivativeCreator.createTokenizedDerivative(defaultConstructorParams, { from: sponsor });

    console.log("INITIALIZED!");
  } catch (e) {
    console.log("ERROR: " + e);
  }
  callback();
};

module.exports = initializeSystem;
