/**
 * The purpose of this script is to deploy several ExpiringMultiParty financial templates.
 * This involves creating and minting collateral tokens, whitelisting price identifiers,
 * and configuring the contracts to use the mock oracle which is more useful for testing.
 *
 * This script is intende to make testing the Sponsor CLI easier.
 */

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");

// Contracts we need to interact with.
let collateralToken;
let emp;
let client;
let syntheticToken;
let mockOracle;
let identifierWhitelist;

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployEMP = async () => {
  const deployer = accounts[0];

  // Deploy collateral token and grant deployer minting privilege.
  collateralToken = await Token.new({ from: deployer });
  await collateralToken.addMember(1, deployer, { from: deployer });
  await collateralToken.mint(deployer, toWei("100000"), { from: deployer });

  // Create identifier whitelist and register the price tracking ticker with it.
  identifierWhitelist = await IdentifierWhitelist.deployed();
  const priceFeedIdentifier = web3.utils.utf8ToHex("BTC/USD");
  await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);

  // Create a mockOracle and finder. Register the mockOracle with the finder.
  mockOracle = await MockOracle.new(identifierWhitelist.address);
  finder = await Finder.deployed();
  const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
  await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

  // Create a new EMP
  const constructorParams = {
    isTest: true,
    expirationTimestamp: "12345678900",
    withdrawalLiveness: "1000",
    collateralAddress: collateralToken.address,
    finderAddress: Finder.address,
    tokenFactoryAddress: TokenFactory.address,
    priceFeedIdentifier: priceFeedIdentifier,
    syntheticName: "BTCUSD",
    syntheticSymbol: "BTCUSD",
    liquidationLiveness: "1000",
    collateralRequirement: { rawValue: toWei("1.5") },
    disputeBondPct: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
    disputerDisputeRewardPct: { rawValue: toWei("0.1") }
  };
  emp = await ExpiringMultiParty.new(constructorParams);

  // To create new tokens or deposit new collateral, must approve EMP to spend collateral.
  await collateralToken.approve(emp.address, toWei("1000000"), { from: deployer });
  // To redeem tokens, must approve EMP to spend synthetic tokens.
  syntheticToken = await Token.at(await emp.tokenCurrency());
  await syntheticToken.approve(emp.address, toWei("100000000"), { from: deployer });
};

module.exports = deployEMP;
