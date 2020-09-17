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
 * Example: $(npm bin)/truffle exec ./scripts/local/DeployEMP.js --network test --test true --identifier ETH/BTC
 */
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TestnetERC20 = artifacts.require("TestnetERC20");
const WETH9 = artifacts.require("WETH9");
const Timer = artifacts.require("Timer");
const TokenFactory = artifacts.require("TokenFactory");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");
const argv = require("minimist")(process.argv.slice(), { boolean: ["test"], string: ["identifier"] });

// Contracts we need to interact with.
let collateralToken;
let emp;
let mockOracle;
let identifierWhitelist;
let collateralTokenWhitelist;
let expiringMultiPartyCreator;
let store;

const empCollateralTokenMap = {
  COMPUSD: TestnetERC20,
  "ETH/BTC": TestnetERC20,
  USDETH: WETH9,
  USDBTC: TestnetERC20
};

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployEMP = async callback => {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    const identifierBase = argv.identifier ? argv.identifier : "ETH/BTC";
    const priceFeedIdentifier = utf8ToHex(identifierBase);

    identifierWhitelist = await IdentifierWhitelist.deployed();
    if (!(await identifierWhitelist.isIdentifierSupported(priceFeedIdentifier))) {
      await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
      console.log("Whitelisted new pricefeed identifier:", hexToUtf8(priceFeedIdentifier));
    }

    // renBTC TestnetERC20: 0x2426C4aaF20DD4501709dDa05d79ebC552d3aE3E
    // DAI TestnetERC20: switch `.at(x)` to `.deployed()`
    collateralToken = await empCollateralTokenMap[identifierBase].at("0x2426C4aaF20DD4501709dDa05d79ebC552d3aE3E");

    if (argv.test) {
      // Create a mockOracle and finder. Register the mockOracle with the finder.
      finder = await Finder.deployed();
      mockOracle = await MockOracle.new(finder.address, Timer.address);
      console.log("Mock Oracle deployed:", mockOracle.address);
      const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
      await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

      // Whitelist collateral currency
      collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
      await collateralTokenWhitelist.addToWhitelist(collateralToken.address);
      console.log("Whitelisted collateral currency");
    }

    store = await Store.deployed();

    // Create a new EMP
    const constructorParams = {
      expirationTimestamp: "1601503200", // 09/30/2020 @ 10:00pm (UTC)
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: "uUSDrBTC Synthetic Token Expiring 1 October 2020",
      syntheticSymbol: "uUSDrBTC-OCT",
      collateralRequirement: { rawValue: toWei("1.35") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.05") },
      disputerDisputeRewardPct: { rawValue: toWei("0.2") },
      minSponsorTokens: { rawValue: toWei("100") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      excessTokenBeneficiary: store.address
    };

    let _emp = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, { from: deployer });
    await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: deployer });
    emp = await ExpiringMultiParty.at(_emp);

    const empConstructorParams = {
      ...constructorParams,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: await expiringMultiPartyCreator.timerAddress()
    };

    const encodedParameters = web3.eth.abi.encodeParameters(ExpiringMultiParty.abi[0].inputs, [empConstructorParams]);
    console.log("Encoded EMP Parameters", encodedParameters);

    // Done!
    console.log(`Created a new EMP @ ${emp.address} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.table(constructorParams);

    // If in test environment, create an initial position so that we can create additional positions via the sponsor CLI.
    // This step assumes that the web3 has access to the account at index 1 (i.e. accounts[1]).
    if (argv.test && collateralToken.address === (await TestnetERC20.deployed()).address) {
      const initialSponsor = accounts[1];
      await collateralToken.allocateTo(initialSponsor, toWei("1200"));
      await collateralToken.approve(emp.address, toWei("1200"), { from: initialSponsor });
      await emp.create({ rawValue: toWei("1200") }, { rawValue: toWei("1000") }, { from: initialSponsor });
      console.log("Created an initial position with CR = 120 % for the sponsor: ", initialSponsor);

      // Mint accounts[0] collateral.
      await collateralToken.allocateTo(accounts[0], toWei("1000000"));
      console.log("Minted accounts[0] 1,000,000 collateral tokens");
    } else if (argv.test && collateralToken.address === (await WETH9.deployed()).address) {
      const initialSponsor = accounts[1];
      await collateralToken.deposit({ value: toWei("1200"), from: initialSponsor });
      await collateralToken.approve(emp.address, toWei("1200"), { from: initialSponsor });
      await emp.create({ rawValue: toWei("1200") }, { rawValue: toWei("1000") }, { from: initialSponsor });
      console.log("Created an initial position with CR = 120 % for the sponsor: ", initialSponsor);

      // Mint accounts[0] collateral.
      await collateralToken.deposit({ value: toWei("1000000"), from: accounts[0] });
      console.log("Converted 1,000,000 collateral WETH for accounts[0]");
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = deployEMP;
