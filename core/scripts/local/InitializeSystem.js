const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const identifiers = require("../../config/identifiers");
const { interfaceName } = require("../../utils/Constants.js");
const { RegistryRolesEnum } = require("../../utils/Enums.js");

const argv = require("minimist")(process.argv.slice());

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

// Deploys a TokenizedDerivative. Used for deploying a contract to Ganache for local testing.
const initializeSystem = async function(callback) {
  try {
    // USAGE: `truffle exec test/scripts/InitializeSystem.js [--identifier <identifier>] --network <network>`
    // <identifier> must be one of the values in supportedIdentifiers
    const supportedIdentifiers = Object.keys(identifiers);

    const deployedFinder = await Finder.deployed();

    const deployedRegistry = await Registry.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry))
    );
    const deployedVoting = await Voting.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    );
    const deployedManualPriceFeed = await ManualPriceFeed.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.PriceFeed))
    );

    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const noLeverageCalculator = await LeveragedReturnCalculator.deployed();

    // Use accounts[1] as the sponsor.
    // When testing the web app, import the mnemonic directly into metamask
    // to use the `sponsor` account defined in this script.
    const sponsor = (await web3.eth.getAccounts())[1];

    // Initialize ManualPriceFeed.
    const price = web3.utils.toWei("1", "ether");
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + 60;
    await deployedManualPriceFeed.setCurrentTime(latestTime);

    // Add support for each identifier.
    for (const identifier of supportedIdentifiers) {
      const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
      await deployedVoting.addSupportedIdentifier(identifierBytes);
      await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);
    }

    // Create and register a margin currency.
    const marginToken = await ERC20Mintable.new({ from: sponsor });
    await marginToken.mint(sponsor, web3.utils.toWei("100", "ether"), { from: sponsor });
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );
    await marginCurrencyWhitelist.addToWhitelist(marginToken.address);
    console.log("Registered margin address:", marginToken.address);

    await deployedRegistry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, tokenizedDerivativeCreator.address);

    // NOTE: Pass arguments through the command line and assign them here
    // in order to customize the instantiated TokenizedDerivative.
    let identifier = supportedIdentifiers[0];
    if (argv.identifier && supportedIdentifiers.indexOf(argv.identifier) !== -1) {
      identifier = argv.identifier;
    }
    console.log("Instantiating with identifier:", identifier);
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));

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
      marginCurrency: marginToken.address,
      withdrawLimit: web3.utils.toWei("0.33", "ether"),
      returnType: "1", // Compound
      startingUnderlyingPrice: "0", // Use price feed
      name: "namenamename",
      symbol: "symbolsymbol"
    };
    await tokenizedDerivativeCreator.createTokenizedDerivative(defaultConstructorParams, { from: sponsor });

    const derivatives = await deployedRegistry.getRegisteredDerivatives(sponsor);
    console.log("Registered derivative at: " + derivatives[0].derivativeAddress);

    console.log("INITIALIZED!");
  } catch (e) {
    console.log("ERROR: " + e);
  }
  callback();
};

module.exports = initializeSystem;
