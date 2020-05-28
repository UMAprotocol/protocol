/**
 * @notice The purpose of this script is to deploy an ExpiringMultiParty financial templates.
 * @dev If you are deploying to a local testnet, set the `--test` flag value to `true` in order to whitelist
 * the collateral currency, approve the pricefeed identifier, use the `MockOracle` contract as the `Oracle` linked
 * with the financial contract, creates an initial sponsor position at the minimum collateralization ratio allowed,
 * and mints collateral tokens to the default sponsor, `accounts[0]`. The testnet version of this script is designed
 * to be used when testing out the sponsor CLI locally. The Sponsor CLI assumes `accounts[0]` to be the default
 * sponsor account.
 * @dev Other helpful scripts to run after this one are:
 * - `./AdvanceEMP.js`: advances EMP time forward, which is useful when testing withdrawal and liquidation requests.
 * - `./LiquidateEMP.js`: liquidates the sponsor's position with `accounts[1]` as the liquidator.
 * - `./DisputeEMP.js`: disputes the default sponsor's liquidations using `accounts[0]` as the disputer.
 * - `./WithdrawLiquidationEMP.js`: withdraws liquidations from `accounts[1]`, i.e. the liquidator. Withdrawing
 *    liquidations as the sponsor can be done via the CLI.
 * - `./PushPriceEMP.js`: "resolves" a pending mock oracle price request with a price.
 *
 *
 * Example: $(npm bin)/truffle exec ./scripts/local/DeployEMP.js --network test --test true
 */
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("../../utils/Constants.js");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TestnetERC20 = artifacts.require("TestnetERC20");
const Timer = artifacts.require("Timer");
const TokenFactory = artifacts.require("TokenFactory");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const argv = require("minimist")(process.argv.slice(), { boolean: ["test"] });

// Contracts we need to interact with.
let collateralToken;
let emp;
let mockOracle;
let identifierWhitelist;
let collateralTokenWhitelist;
let expiringMultiPartyCreator;

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployEMP = async callback => {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    // Use Dai as the collateral token.
    collateralToken = await TestnetERC20.deployed();

    const priceFeedIdentifier = utf8ToHex("ETH/BTC");

    if (argv.test) {
      // Create a mockOracle and finder. Register the mockOracle with the finder.
      finder = await Finder.deployed();
      mockOracle = await MockOracle.new(finder.address, Timer.address);
      console.log("Mock Oracle deployed:", mockOracle.address);
      const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
      await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

      // Whitelist the pricefeed identifier.
      identifierWhitelist = await IdentifierWhitelist.deployed();
      await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
      console.log("Whitelisted new pricefeed identifier:", hexToUtf8(priceFeedIdentifier));

      // Whitelist collateral currency
      collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
      await collateralTokenWhitelist.addToWhitelist(collateralToken.address);
      console.log("Whitelisted collateral currency");
    }

    // Create a new EMP
    const constructorParams = {
      expirationTimestamp: "1596240000", // 2020-08-01T00:00:00.000Z. Note, this date will no longer work once it is in the past.
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: "ETH/BTC Synthetic Token Expiring 1 August 2020",
      syntheticSymbol: "ETHBTC-AUG20",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.03") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.05") },
      disputerDisputeRewardPct: { rawValue: toWei("0.05") },
      minSponsorTokens: { rawValue: toWei("1000") }
    };
    let _emp = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, { from: deployer });
    await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: deployer });
    emp = await ExpiringMultiParty.at(_emp);

    const empConstructorParams = {
      ...constructorParams,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: await expiringMultiPartyCreator.timerAddress(),
      withdrawalLiveness: (await expiringMultiPartyCreator.STRICT_WITHDRAWAL_LIVENESS()).toString(),
      liquidationLiveness: (await expiringMultiPartyCreator.STRICT_LIQUIDATION_LIVENESS()).toString()
    };

    const encodedParameters = web3.eth.abi.encodeParameters(ExpiringMultiParty.abi[0].inputs, [empConstructorParams]);
    console.log("Encoded EMP Parameters", encodedParameters);

    // Done!
    console.log(`Created a new EMP @ ${emp.address} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.table(constructorParams);

    // If in test environment, create an initial position so that we can create additional positions via the sponsor CLI.
    // This step assumes that the web3 has access to the account at index 1 (i.e. accounts[1]).
    if (argv.test) {
      const initialSponsor = accounts[1];
      await collateralToken.allocateTo(initialSponsor, toWei("1200"));
      await collateralToken.approve(emp.address, toWei("1200"), { from: initialSponsor });
      await emp.create({ rawValue: toWei("1200") }, { rawValue: toWei("1000") }, { from: initialSponsor });
      console.log("Created an initial position with CR = 120 % for the sponsor: ", initialSponsor);

      // Mint accounts[0] collateral.
      await collateralToken.allocateTo(accounts[0], toWei("1000000"));
      console.log("Minted accounts[0] 1,000,000 collateral tokens");
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = deployEMP;
