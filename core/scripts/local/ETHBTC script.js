/**
 * The purpose of this script is to deploy several ExpiringMultiParty financial templates.
 * This involves creating and minting collateral tokens, whitelisting price identifiers,
 * and configuring the contracts to use the mock oracle which is more useful for testing.
 *
 * This script is intended to make testing the Sponsor CLI easier.
 */
const { toWei } = web3.utils;
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { interfaceName } = require("../../utils/Constants.js");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const Token = artifacts.require("ExpandedERC20");
const Registry = artifacts.require("Registry");
const TestnetERC20 = artifacts.require("TestnetERC20");
const Timer = artifacts.require("Timer");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const TokenFactory = artifacts.require("TokenFactory");

// Contracts we need to interact with.
let collateralToken;
let emp;
let syntheticToken;
let mockOracle;
let identifierWhitelist;
let registry;
let expiringMultiPartyCreator;

const zeroAddress = "0x0000000000000000000000000000000000000000";

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployEMP = async callback => {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    // Create position with a non-default account so the default CLI user can go through the new sponsor experience.
    const firstSponsor = accounts[1];
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    // Use Dai as the collateral token.
    collateralToken = await TestnetERC20.deployed();

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    const priceFeedIdentifier = web3.utils.utf8ToHex("ETHBTC-DAI");
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);

    const collateralWhitelist = await AddressWhitelist.deployed();
    await collateralWhitelist.addToWhitelist(collateralToken.address);

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, "0x0000000000000000000000000000000000000000");
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

    // Grant EMP the right to register new financial templates.
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: deployer
    });

    // Create a new EMP
    const constructorParams = {
      expirationTimestamp: "1601510400", // 2020-09-01T00:00:00.000Z. Note, this date will no longer work once it is in the past.
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: "ETHBTC",
      syntheticSymbol: "ETHBTC",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.03") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.05") },
      disputerDisputeRewardPct: { rawValue: toWei("0.05") },
      minSponsorTokens: { rawValue: toWei("0.01") }
    };
    console.log("deploying EMP with params", constructorParams);
    let _emp = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, { from: deployer });
    let createTx = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: deployer });
    console.log("createTx", createTx);
    emp = await ExpiringMultiParty.at(_emp);

    // To create new tokens or deposit new collateral, must approve EMP to spend collateral.
    await collateralToken.approve(emp.address, toWei("1000000"), { from: firstSponsor });
    // To redeem tokens, must approve EMP to spend synthetic tokens.
    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: firstSponsor });

    // Create one small position so that you can create new positions from the CLI
    // (currently, it does not support creating the first position for the EMP).
    // Collateralize this at the minimum CR allowed.
    // Acquire 1000 of the collateralToken by depositing 1000 ETH.
    // await collateralToken.deposit({ value: toWei("1000"), from: firstSponsor });
    await emp.create({ rawValue: toWei("48000") }, { rawValue: toWei("1000000") }, { from: firstSponsor });

    const empConstructorParams = {
      ...constructorParams,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: zeroAddress,
      withdrawalLiveness: 7200,
      liquidationLiveness: 7200
    };
    // ​
    const encodedParams = web3.eth.abi.encodeParameters(ExpiringMultiParty.abi[0].inputs, [empConstructorParams]);

    // Done!
    console.log("deployment done!");
    console.log(`Using Mock Oracle @ ${mockOracle.address}`);
    console.log(`Created a new EMP @ ${emp.address} with the configuration:`);
    console.log(`Deployer address @ ${deployer}`);
    console.log(`First sponsor with under-collateralized position @ ${firstSponsor}`);
    console.table(constructorParams);
    console.log("Encoded params", encodedParams);

    await syntheticToken.transfer("0xf16B3B4bf2E21B04A9BF771863D06ECE3585daB7", toWei("500000"), {
      from: firstSponsor
    });
  } catch (err) {
    console.error(err);
  }
  callback();
};

module.exports = deployEMP;
