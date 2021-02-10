/**
 * @notice The purpose of this script is to deploy a Perpetual financial template.
 * @dev If you are deploying to a local testnet, set the `--test` flag value to `true` in order to whitelist
 * the collateral currency, approve the pricefeed identifier, use the `MockOracle` contract as the `Oracle` linked
 * with the financial contract, creates an initial sponsor position at the minimum collateralization ratio allowed,
 * and mints collateral tokens to the default sponsor, `accounts[0]`. The testnet version of this script is designed
 * to be used when testing out the sponsor CLI locally. The Sponsor CLI assumes `accounts[0]` to be the default
 * sponsor account.
 * @dev Flags:
 * - "test": {*Boolean=false} Set to true to complete DVM-related prerequisites before a new Perpetual can be deployed,
 *           and use the MockOracle as the DVM.
 * - "identifier": {*String="ETH/BTC"} Customize the price identifier for the Perpetual.
 *
 * Example: $(npm bin)/truffle exec ./packages/core/scripts/local/DeployPerpetual.js --network test --test true --identifier ETH/BTC --cversion latest
 */
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("@uma/common");
const { getAbi, getTruffleContract } = require("../../index");
const argv = require("minimist")(process.argv.slice(), {
  boolean: ["test"],
  string: ["identifier", "collateral", "cversion"]
});
const abiVersion = argv.cversion || "latest"; // Default to most recent mainnet deployment, latest.

// Deployed contract ABI's and addresses we need to fetch.
const PerpetualCreator = getTruffleContract("PerpetualCreator", web3, abiVersion);
const Perpetual = getTruffleContract("Perpetual", web3, abiVersion);
const Finder = getTruffleContract("Finder", web3, abiVersion);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, abiVersion);
const MockOracle = getTruffleContract("MockOracle", web3, abiVersion);
const TestnetERC20 = getTruffleContract("TestnetERC20", web3, abiVersion);
const WETH9 = getTruffleContract("WETH9", web3, abiVersion);
const Timer = getTruffleContract("Timer", web3, abiVersion);
const TokenFactory = getTruffleContract("TokenFactory", web3, abiVersion);
const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, abiVersion);

const isUsingWeth = identifier => {
  return identifier.toUpperCase().endsWith("ETH");
};

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployPerpetual = async callback => {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    const perpetualCreator = await PerpetualCreator.deployed();
    const finder = await Finder.deployed();
    const tokenFactory = await TokenFactory.deployed();
    console.log("TokenFactory:", tokenFactory.address);

    const identifierBase = argv.identifier ? argv.identifier : "ETH/BTC";
    const priceFeedIdentifier = utf8ToHex(identifierBase);

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    if (!(await identifierWhitelist.isIdentifierSupported(priceFeedIdentifier))) {
      await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
      console.log("Whitelisted new pricefeed identifier:", hexToUtf8(priceFeedIdentifier));
    }

    const fundingRateIdentifierBase = argv.fundingRateIdentifier ? argv.identifier : "ETHUSD";
    const fundingRateIdentifier = utf8ToHex(fundingRateIdentifierBase);

    const maxFundingRate = toWei("0.00001");
    const minFundingRate = toWei("-0.00001");

    // This subs in WETH where necessary.
    const TokenContract = isUsingWeth(identifierBase) ? WETH9 : TestnetERC20;

    let collateralToken;
    if (!argv.collateral) {
      collateralToken = await TokenContract.deployed();
    } else {
      // Mainnet renBTC: 0x2426C4aaF20DD4501709dDa05d79ebC552d3aE3E
      collateralToken = await TokenContract.at(argv.collateral);
    }

    if (argv.test) {
      // When running in test mode, deploy a mock oracle and whitelist the collateral currency used.
      const mockOracle = await MockOracle.new(finder.address, Timer.address);
      console.log("Mock Oracle deployed:", mockOracle.address);
      const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
      await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

      // Whitelist collateral currency
      const collateralTokenWhitelist = await AddressWhitelist.deployed();
      await collateralTokenWhitelist.addToWhitelist(collateralToken.address);
      console.log("Whitelisted collateral currency");
    }

    // Create a new Perpetual
    const constructorParams = {
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: priceFeedIdentifier,
      fundingRateIdentifier: fundingRateIdentifier,
      syntheticName: "New Perpetual Contract Test",
      syntheticSymbol: "NEW-PERP-TEST",
      collateralRequirement: { rawValue: toWei("1.35") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.05") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.2") },
      minSponsorTokens: { rawValue: toWei("100") },
      tokenScaling: { rawValue: toWei("1") },
      withdrawalLiveness: 7200,
      liquidationLiveness: 7200
    };

    const configSettings = {
      rewardRatePerSecond: { rawValue: "0" },
      proposerBondPercentage: { rawValue: "0" },
      timelockLiveness: 86400, // 1 day
      maxFundingRate: { rawValue: maxFundingRate },
      minFundingRate: { rawValue: minFundingRate },
      proposalTimePastLimit: 0
    };

    let _perpetual = await perpetualCreator.createPerpetual.call(constructorParams, configSettings, { from: deployer });
    await perpetualCreator.createPerpetual(constructorParams, configSettings, { from: deployer });
    const perpetual = await Perpetual.at(_perpetual);
    const tokenAddress = await perpetual.tokenCurrency();
    const configStoreAddress = await perpetual.configStore();
    const timerAddress = await perpetualCreator.timerAddress();

    const perpetualConstructorParams = {
      ...constructorParams,
      tokenAddress,
      configStoreAddress,
      finderAddress: finder.address,
      tokenFactoryAddress: tokenFactory.address,
      timerAddress
    };

    const configStoreConstructorParams = {
      ...configSettings
    };

    const encodedParameters = web3.eth.abi.encodeParameters(getAbi("Perpetual", abiVersion)[0].inputs, [
      perpetualConstructorParams
    ]);
    console.log("Encoded Perpetual Parameters", encodedParameters);

    // Done!
    console.log(`Created a new Perpetual @ ${perpetual.address} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.table(constructorParams);

    const encodedConfigStoreParameters = web3.eth.abi.encodeParameters(getAbi("ConfigStore", abiVersion)[0].inputs, [
      configStoreConstructorParams,
      timerAddress
    ]);
    console.log("Encoded Config Store Parameters", encodedConfigStoreParameters);

    // Done!
    console.log(`Created a new Config Store @ ${configStoreAddress} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.table(configSettings);

    if (argv.test) {
      const initialSponsor = accounts[1];

      // Grab tokens differently in the WETH case.
      if (isUsingWeth(identifierBase)) {
        // Mint accounts[1] collateral.
        await collateralToken.deposit({ value: toWei("1200"), from: initialSponsor });

        // Mint accounts[0] collateral.
        await collateralToken.deposit({ value: toWei("1000000"), from: accounts[0] });
        console.log("Converted 1,000,000 collateral WETH for accounts[0]");
      } else {
        // Mint accounts[1] collateral.
        await collateralToken.allocateTo(initialSponsor, toWei("1200"));

        // Mint accounts[0] collateral.
        await collateralToken.allocateTo(accounts[0], toWei("1000000"));
      }
      console.log("Minted account 1 1200 collateral tokens and account 0 1,000,000 collateral tokens");

      // Create the in initial position.
      await collateralToken.approve(perpetual.address, toWei("1200"), { from: initialSponsor });
      await perpetual.create({ rawValue: toWei("1200") }, { rawValue: toWei("1000") }, { from: initialSponsor });
      console.log(
        "Created an initial position with 1.2 collateral tokens for each synthetic token for the sponsor:",
        initialSponsor
      );
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = deployPerpetual;
