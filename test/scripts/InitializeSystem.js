const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

const BigNumber = require("bignumber.js");

const initializeSystem = async function(callback) {
  try {
    const sponsor = (await web3.eth.getAccounts())[1];
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
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );

    // Add mock DAI to margin currency whitelist
    const marginToken = await ERC20Mintable.new({ from: sponsor });
    await marginToken.mint(sponsor, web3.utils.toWei("100", "ether"), { from: sponsor });
    console.log("margin address", marginToken.address);
    await marginCurrencyWhitelist.addToWhitelist(marginToken.address);

    await deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    await deployedManualPriceFeed.setCurrentTime(100000);
    const price = web3.utils.toWei("1", "ether");
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + 60;
    // NOTE: ONLY RUN THE FOLLOWING TWO LINES THE _FIRST_ TIME.
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);

    await deployedRegistry.addDerivativeCreator(tokenizedDerivativeCreator.address);

    let defaultConstructorParams = {
      sponsor: sponsor,
      defaultPenalty: web3.utils.toWei("0.5", "ether"),
      supportedMove: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
      disputeDeposit: web3.utils.toWei("0.5", "ether"),
      returnCalculator: noLeverageCalculator.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: 0,
      marginCurrency: "0x0000000000000000000000000000000000000000",
      withdrawLimit: web3.utils.toWei("0.33", "ether"),
      returnType: "1", // Compound
      startingUnderlyingPrice: "0", // Use price feed
      name: "namenamename",
      symbol: "symsolsymbol"
    };
    await tokenizedDerivativeCreator.createTokenizedDerivative(defaultConstructorParams, { from: sponsor });

    console.log("INITIALIZED!");
  } catch (e) {
    console.log("ERROR: " + e);
  }
  callback();
};

module.exports = initializeSystem;
