/**
 * @notice The purpose of this script is to deploy an ExpiringMultiParty financial templates.
 * @dev If you are deploying to a local testnet, set the `--test` flag value to `true` in order to whitelist
 * the collateral currency, approve the pricefeed identifier, use the `MockOracle` contract as the `Oracle` linked
 * with the financial contract, creates an initial sponsor position at the minimum collateralization ratio allowed,
 * and mints collateral tokens to the default sponsor, `accounts[0]`. The testnet version of this script is designed
 * to be used when testing out the sponsor CLI locally. The Sponsor CLI assumes `accounts[0]` to be the default
 * sponsor account.
 * @dev Flags:
 * - "test": {*Boolean=false} Set to true to complete DVM-related prerequisites before a new EMP can be deployed,
 *           and use the MockOracle as the DVM.
 * - "identifier": {*String="ETH/BTC"} Customize the price identifier for the EMP.
 * @dev Other helpful scripts to run after this one are:
 * - `./AdvanceEMP.js`: advances EMP time forward, which is useful when testing withdrawal and liquidation requests.
 * - `./LiquidateEMP.js`: liquidates the sponsor's position with `accounts[1]` as the liquidator.
 * - `./DisputeEMP.js`: disputes the default sponsor's liquidations using `accounts[0]` as the disputer.
 * - `./WithdrawLiquidationEMP.js`: withdraws liquidations from `accounts[1]`, i.e. the liquidator. Withdrawing
 *    liquidations as the sponsor can be done via the CLI.
 * - `./PushPriceEMP.js`: "resolves" a pending mock oracle price request with a price.
 *
 *
 * Example: yarn truffle exec ./packages/core/scripts/local/DeployEMP.js --network test --test true --identifier ETH/BTC --cversion 1.2.2
 */
const { toWei, utf8ToHex, hexToUtf8, padRight } = web3.utils;
const { interfaceName, ZERO_ADDRESS, parseFixed } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const { getAbi, getTruffleContract } = require("../../dist/index");
const argv = require("minimist")(process.argv.slice(), {
  boolean: ["test"],
  string: ["identifier", "collateral", "cversion", "name", "symbol", "duration"],
  number: ["gasprice"],
});
const abiVersion = argv.cversion || "1.2.2"; // Default to most recent mainnet deployment, 1.2.2.
const syntheticName = argv.name || "Test Synth";
const syntheticSymbol = argv.symbol || "SYNTH";
const duration = argv.duration || 2 * 60;
const expirationTimestamp = Math.ceil(Date.now() / 1000) + Number(duration); // 2 minutes from now

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = getTruffleContract("ExpiringMultiPartyCreator", web3, abiVersion);
const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, abiVersion);
const Finder = getTruffleContract("Finder", web3, abiVersion);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, abiVersion);
const MockOracle = getTruffleContract("MockOracle", web3, abiVersion);
const TestnetERC20 = getTruffleContract("TestnetERC20", web3, abiVersion);
const WETH9 = getTruffleContract("WETH9", web3, abiVersion);
const Timer = getTruffleContract("Timer", web3, abiVersion);
const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, abiVersion);

const isUsingWeth = (identifier) => {
  return identifier.toUpperCase().endsWith("ETH");
};

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployEMP = async (callback) => {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    const finder = await Finder.deployed();

    const identifierBase = argv.identifier ? argv.identifier : "ETH/BTC";
    const priceFeedIdentifier = padRight(utf8ToHex(identifierBase), 64);

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    if (!(await identifierWhitelist.isIdentifierSupported(priceFeedIdentifier))) {
      await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
      console.log("Whitelisted new pricefeed identifier:", hexToUtf8(priceFeedIdentifier));
    }

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

    // Minimum sponsor size needs to be denominated with same currency as tokenCurrency,
    // which will be the same as the collateral precision if the abiVersion is "latest",
    // otherwise 18.
    const syntheticTokenDecimals = (await collateralToken.decimals()).toString();
    const minSponsorTokens = parseFixed("100", syntheticTokenDecimals).toString();

    // Create a new EMP
    let constructorParams = {
      expirationTimestamp: expirationTimestamp,
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: syntheticName,
      syntheticSymbol: syntheticSymbol,
      collateralRequirement: { rawValue: toWei("1.35") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.05") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.2") },
      minSponsorTokens: { rawValue: minSponsorTokens },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
    };

    // Inject constructor params neccessary for "latest" version of the EMPCreator:
    if (abiVersion === "latest") {
      constructorParams = { ...constructorParams, financialProductLibraryAddress: ZERO_ADDRESS };
    }

    const gasEstimator = new GasEstimator(
      winston.createLogger({ silent: true }),
      60, // Time between updates.
      await web3.eth.net.getId()
    );
    await gasEstimator.update();
    const transactionParams = {
      gas: 12000000, // 12MM is very high. Set this lower if you only have < 2 ETH or so in your wallet.
      ...gasEstimator.getCurrentFastPrice(),
      from: deployer,
      chainId: await web3.eth.getChainId(),
    };
    const _emp = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, transactionParams);
    await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, transactionParams);
    const emp = await ExpiringMultiParty.at(_emp);

    let empConstructorParams = {
      ...constructorParams,
      finderAddress: finder.address,
      timerAddress: await expiringMultiPartyCreator.timerAddress(),
    };

    // Delete params only needed to pass into EMPCreator.deploy() method that are not included in EMP constructor
    // params.
    delete empConstructorParams["syntheticName"];
    delete empConstructorParams["syntheticSymbol"];

    // Grab `tokenAddress` from newly constructed EMP and add to `empConstructorParams` for new EMP's
    if (abiVersion === "latest") {
      empConstructorParams = { ...empConstructorParams, tokenAddress: await emp.tokenCurrency() };
    }

    const encodedParameters = web3.eth.abi.encodeParameters(getAbi("ExpiringMultiParty", abiVersion)[0].inputs, [
      empConstructorParams,
    ]);

    // Done!
    console.log(`Created a new EMP @ ${emp.address} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.log("Encoded EMP Parameters", encodedParameters.slice(2));
    console.table(empConstructorParams);

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
      await collateralToken.approve(emp.address, toWei("1200"), { from: initialSponsor });
      await emp.create({ rawValue: toWei("1200") }, { rawValue: toWei("1000") }, { from: initialSponsor });
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

module.exports = deployEMP;
