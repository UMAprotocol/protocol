const { toWei, utf8ToHex } = web3.utils;

const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, MAX_UINT_VAL } = require("@uma/common");

// Tested Contract
const ContractForDifference = artifacts.require("ContractForDifference");
const ContractForDifferenceFinancialProjectLibraryTest = artifacts.require(
  "ContractForDifferenceFinancialProjectLibraryTest"
);

// Helper contracts
const AddressWhitelist = artifacts.require("AddressWhitelist");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const Token = artifacts.require("ExpandedERC20");

// Contracts
let collateralToken;
let longToken;
let shortToken;
let contractForDifference;
let contractForDifferenceLibrary;
let collateralWhitelist;
let identifierWhitelist;
let optimisticOracle;
let finder;
let ancillaryData;
let timer;

const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const optimisticOracleLiveness = 7200;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.

const proposeAndSettleOptimisticOraclePrice = async (priceFeedIdentifier, requestTime, price) => {
  await optimisticOracle.proposePrice(
    contractForDifference.address,
    priceFeedIdentifier,
    requestTime,
    ancillaryData,
    price
  );
  await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()) + optimisticOracleLiveness);
  await optimisticOracle.settle(contractForDifference.address, priceFeedIdentifier, requestTime, ancillaryData);
};

contract("ContractForDifference", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];
  const holder = accounts[2];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
  });

  beforeEach(async function () {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.setCurrentTime(startTimestamp);

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });
    await collateralToken.mint(sponsor, toWei("1000"), { from: deployer });

    await collateralWhitelist.addToWhitelist(collateralToken.address);

    longToken = await Token.new("Long Token", "lTKN", 18, { from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18, { from: deployer });
    ancillaryData = longToken.address + shortToken.address.substring(2, 42);

    optimisticOracle = await OptimisticOracle.new(optimisticOracleLiveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: deployer,
    });

    // Create CFD library and CFD contract.
    contractForDifferenceLibrary = await ContractForDifferenceFinancialProjectLibraryTest.new();

    contractForDifference = await ContractForDifference.new(
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      longToken.address,
      shortToken.address,
      collateralToken.address,
      finder.address,
      contractForDifferenceLibrary.address,
      timer.address
    );

    // Add mint and burn roles for the long and short tokens to the contract for difference.
    await longToken.addMember(1, contractForDifference.address, { from: deployer });
    await shortToken.addMember(1, contractForDifference.address, { from: deployer });
    await longToken.addMember(2, contractForDifference.address, { from: deployer });
    await shortToken.addMember(2, contractForDifference.address, { from: deployer });
  });
  it("Mint, redeem, expire lifecycle", async function () {
    // Create some sponsor tokens. Send half to the holder account.
    assert.equal(await collateralToken.balanceOf(sponsor), toWei("1000"));
    assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
    assert.equal(await shortToken.balanceOf(sponsor), toWei("0"));

    await collateralToken.approve(contractForDifference.address, MAX_UINT_VAL, { from: sponsor });
    await contractForDifference.create(toWei("100"), { from: sponsor });

    // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
    assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("900")); // 1000 starting balance - 100 for mint.
    assert.equal(await longToken.balanceOf(sponsor), toWei("100"));
    assert.equal(await shortToken.balanceOf(sponsor), toWei("100"));

    // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
    await longToken.transfer(holder, toWei("50"), { from: sponsor });

    // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
    await contractForDifference.redeem(toWei("25"), { from: sponsor });

    // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
    assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("925")); // 900 after mint + 25 redeemed.
    assert.equal(await longToken.balanceOf(sponsor), toWei("25"));
    assert.equal(await shortToken.balanceOf(sponsor), toWei("75"));

    // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
    assert(await didContractThrow(contractForDifference.redeem(toWei("25"), { from: holder })));

    // Advance past the expiry timestamp and settle the contract.
    await timer.setCurrentTime(expirationTimestamp + 1);

    assert.equal(await contractForDifference.contractState(), 0); // state should be Open before.
    await contractForDifference.expire();
    assert.equal(await contractForDifference.contractState(), 1); // state should be ExpiredPriceRequested before.

    await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

    // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
    // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.

    await contractForDifferenceLibrary.setValueToReturn(toWei("0.5"));

    await contractForDifference.settle(toWei("50"), toWei("0"), { from: holder }); // holder redeem their 50 long tokens.
    assert.equal(await longToken.balanceOf(holder), toWei("0")); // they should have no long tokens left.
    assert.equal((await collateralToken.balanceOf(holder)).toString(), toWei("25")); // they should have gotten 0.5 collateral per synthetic.

    // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
    await contractForDifference.settle(toWei("25"), toWei("75"), { from: sponsor });

    assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
    assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
    assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("975")); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

    // Contract for difference should have no collateral left in it as everything has been redeemed.
    assert.equal((await collateralToken.balanceOf(contractForDifference.address)).toString(), toWei("0"));
  });
});
