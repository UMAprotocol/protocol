const { didContractThrow } = require("./SolidityTestUtils.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const BigNumber = require("bignumber.js");
const truffleAssert = require("truffle-assertions");

contract("CentralizedOracle", function(accounts) {
  // A deployed instance of the CentralizedOracle contract, ready for testing.
  let centralizedOracle;
  let registry;

  const owner = accounts[0];
  const sponsor = accounts[1];
  const rando = accounts[2];
  const creator = accounts[3];

  const oraclePriceDelay = 60 * 60 * 24 * 7;

  before(async function() {
    centralizedOracle = await CentralizedOracle.deployed();

    // Add creator and register owner as an approved derivative.
    registry = await Registry.deployed();
    await registry.addDerivativeCreator(creator, { from: owner });
    await registry.registerDerivative([], owner, { from: creator });

    // Whitelist ETH margin currency.
    const ethAddress = "0x0000000000000000000000000000000000000000";
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const marginCurrencyWhitelistAddress = await tokenizedDerivativeCreator.marginCurrencyWhitelist();
    const marginCurrencyWhitelist = await AddressWhitelist.at(marginCurrencyWhitelistAddress);
    await marginCurrencyWhitelist.addToWhitelist(ethAddress);
  });

  it("Enqueue queries (two times) > Push > Requery > Push > Request", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("identifier"));
    const firstTime = 10;
    const price = 500;
    const secondTime = 20;

    // Configure the oracle to support the identifiers used in this test.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // No queries are currently stored.
    let pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 0);

    // Enqueue the request for a price.
    let currentTime = 100;
    await centralizedOracle.setCurrentTime(currentTime);
    let expectedTime = await centralizedOracle.requestPrice.call(identifierBytes, firstTime);
    await centralizedOracle.requestPrice(identifierBytes, firstTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);

    // Check that the query is pending. Trying to get the price should revert.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);
    assert.isFalse(await centralizedOracle.hasPrice(identifierBytes, firstTime));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, firstTime)));

    // Enqueue the second request for a price.
    currentTime = 5000;
    await centralizedOracle.setCurrentTime(currentTime);
    expectedTime = await centralizedOracle.requestPrice.call(identifierBytes, secondTime);
    await centralizedOracle.requestPrice(identifierBytes, secondTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);
    assert.isFalse(await centralizedOracle.hasPrice(identifierBytes, secondTime));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, secondTime)));

    // Check that both queries are pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 2);

    // Push a price for the first identifier.
    const firstPricePushTime = 10000;
    await centralizedOracle.setCurrentTime(firstPricePushTime);
    await centralizedOracle.pushPrice(identifierBytes, firstTime, price);

    // Get first price, and verify that `requestPrice` indicates that the price is available.
    expectedTime = await centralizedOracle.requestPrice.call(identifierBytes, firstTime);
    assert.equal(expectedTime, 0);
    assert.isTrue(await centralizedOracle.hasPrice(identifierBytes, firstTime));
    let oraclePrice = await centralizedOracle.getPrice(identifierBytes, firstTime);
    assert.equal(oraclePrice, price);

    // Check that the second query is pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);

    // Push a price for the second identifier.
    const secondPricePushTime = 20000;
    await centralizedOracle.setCurrentTime(secondPricePushTime);
    await centralizedOracle.pushPrice(identifierBytes, secondTime, price);

    // Get second price.
    expectedTime = await centralizedOracle.requestPrice.call(identifierBytes, secondTime);
    assert.equal(expectedTime, 0);
    assert.isTrue(await centralizedOracle.hasPrice(identifierBytes, secondTime));
    oraclePrice = await centralizedOracle.getPrice(identifierBytes, secondTime);
    assert.equal(oraclePrice, price);

    // Get the first price again, just to double check.
    expectedTime = await centralizedOracle.requestPrice.call(identifierBytes, firstTime);
    assert.equal(expectedTime, 0);
    assert.isTrue(await centralizedOracle.hasPrice(identifierBytes, firstTime));
    oraclePrice = await centralizedOracle.getPrice(identifierBytes, firstTime);
    assert.equal(oraclePrice, price);
  });

  it("Enqueue queries (two identifiers) > Push > Requery > Push > Requery", async function() {
    const firstIdentifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("First"));
    const firstTime = 10;
    const firstPrice = 500;

    const secondIdentifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Second"));
    const secondTime = 10;
    const secondPrice = 1000;

    // Configure the oracle to support the identifiers used in this test.
    await centralizedOracle.addSupportedIdentifier(firstIdentifierBytes);
    await centralizedOracle.addSupportedIdentifier(secondIdentifierBytes);

    // No queries are currently stored.
    let pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 0);

    // Enqueue the request for a price.
    let currentTime = 100;
    await centralizedOracle.setCurrentTime(currentTime);
    let expectedTime = await centralizedOracle.requestPrice.call(firstIdentifierBytes, firstTime);
    await centralizedOracle.requestPrice(firstIdentifierBytes, firstTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);

    // Check that the query is pending
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);
    assert.equal(pendingQueries[0].time, firstTime);

    // Enqueue a second request for a price.
    expectedTime = await centralizedOracle.requestPrice.call(secondIdentifierBytes, secondTime);
    await centralizedOracle.requestPrice(secondIdentifierBytes, secondTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);

    // Check that both queries are pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 2);

    // Prices are still not available, until a price is pushed.
    expectedTime = await centralizedOracle.requestPrice.call(firstIdentifierBytes, firstTime);
    await centralizedOracle.requestPrice(firstIdentifierBytes, firstTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);
    expectedTime = await centralizedOracle.requestPrice.call(secondIdentifierBytes, secondTime);
    await centralizedOracle.requestPrice(secondIdentifierBytes, secondTime);
    assert.equal(expectedTime, currentTime + oraclePriceDelay);
    assert.isFalse(await centralizedOracle.hasPrice(firstIdentifierBytes, firstTime));
    assert.isFalse(await centralizedOracle.hasPrice(secondIdentifierBytes, secondTime));

    // Push a price for the second identifier.
    await centralizedOracle.pushPrice(secondIdentifierBytes, secondTime, secondPrice);

    // Price should now be available.
    expectedTime = await centralizedOracle.requestPrice.call(secondIdentifierBytes, secondTime);
    assert.equal(expectedTime, 0);
    assert.isTrue(await centralizedOracle.hasPrice(secondIdentifierBytes, secondTime));
    let oraclePrice = await centralizedOracle.getPrice(secondIdentifierBytes, secondTime);
    assert.equal(oraclePrice, secondPrice);

    // First request is still pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);
    assert.equal(pendingQueries[0].time, firstTime);

    // Push a price for the first identifier.
    await centralizedOracle.pushPrice(firstIdentifierBytes, firstTime, firstPrice);

    // Price should now be available.
    expectedTime = await centralizedOracle.requestPrice.call(firstIdentifierBytes, firstTime);
    assert.equal(expectedTime, 0);
    assert.isTrue(await centralizedOracle.hasPrice(firstIdentifierBytes, firstTime));
    oraclePrice = await centralizedOracle.getPrice(firstIdentifierBytes, firstTime);
    assert.equal(oraclePrice, firstPrice);

    // No pending queries.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 0);
  });

  it("Admin", async function() {
    // Initialize a TokenizedDerivative for this test case.
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Admin"));
    const manualPriceFeed = await ManualPriceFeed.deployed();
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const noLeverageCalculator = await LeveragedReturnCalculator.deployed();

    await centralizedOracle.addSupportedIdentifier(identifierBytes);
    await manualPriceFeed.setCurrentTime(500);
    await manualPriceFeed.pushLatestPrice(identifierBytes, 450, web3.utils.toWei("1", "ether"));

    const constructorParams = {
      sponsor: sponsor,
      defaultPenalty: web3.utils.toWei("0.05", "ether"),
      supportedMove: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
      disputeDeposit: web3.utils.toWei("0.05", "ether"),
      returnCalculator: noLeverageCalculator.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: "0",
      marginCurrency: "0x0000000000000000000000000000000000000000",
      withdrawLimit: web3.utils.toWei("0.33", "ether"),
      startingUnderlyingPrice: "0",
      returnType: "1", // Compound
      name: "1x coin",
      symbol: "BTCETH"
    };

    await tokenizedDerivativeCreator.createTokenizedDerivative(constructorParams, { from: sponsor });
    const deployedRegistry = await Registry.deployed();
    const derivativeArray = await deployedRegistry.getRegisteredDerivatives(sponsor);
    const derivativeAddress = derivativeArray[derivativeArray.length - 1].derivativeAddress;
    const derivativeContract = await TokenizedDerivative.at(derivativeAddress);

    assert.equal((await derivativeContract.derivativeStorage()).state, "0");
    assert.equal((await derivativeContract.derivativeStorage()).currentTokenState.time, "450");

    // Only the owner of the Oracle can use these methods.
    assert(await didContractThrow(centralizedOracle.callEmergencyShutdown(derivativeContract, { from: rando })));
    assert(await didContractThrow(centralizedOracle.callRemargin(derivativeContract, { from: rando })));

    // Verify that the Oracle passes on remargin() to the derivative.
    await manualPriceFeed.pushLatestPrice(identifierBytes, 475, web3.utils.toWei("1", "ether"));
    await centralizedOracle.callRemargin(derivativeAddress);
    assert.equal((await derivativeContract.derivativeStorage()).currentTokenState.time, "475");

    // Verify that the Oracle passes on emergencyShutdown() to the derivative.
    await centralizedOracle.callEmergencyShutdown(derivativeAddress);
    assert.equal((await derivativeContract.derivativeStorage()).state, "4");
  });

  it("Non owner", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

    // Non-owners can't add supported identifiers.
    assert(await didContractThrow(centralizedOracle.addSupportedIdentifier(identifierBytes, { from: rando })));

    // Configure the oracle to support the identifiers used in this test, as an owner.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Non-owners can't push prices.
    assert(await didContractThrow(centralizedOracle.pushPrice(identifierBytes, 10, 10, { from: rando })));
  });

  it("Push unqueried price", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unqueried"));

    // Configure the oracle to support the identifiers used in this test.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Can't push a price that isn't queried yet.
    assert(await didContractThrow(centralizedOracle.pushPrice(identifierBytes, 10, 10)));
  });

  it("Double add identifier", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Double"));

    // Add the identifier for the first time.
    let result = await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Should produce event on the first add.
    truffleAssert.eventEmitted(result, "AddSupportedIdentifier", ev => {
      // Note: the toAscii result fails a comparison with "Double", so we went with a hardcoded hex string.
      return ev.identifier.toString() === "0x446f75626c650000000000000000000000000000000000000000000000000000";
    });

    // Make sure the identifier is now supported.
    assert.isTrue(await centralizedOracle.isIdentifierSupported(identifierBytes));

    // Add the identifier a second time.
    result = await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // No event should be produced.
    truffleAssert.eventNotEmitted(result, "AddSupportedIdentifier");

    // Make sure the identifier is still supported.
    assert.isTrue(await centralizedOracle.isIdentifierSupported(identifierBytes));
  });

  it("Unsupported product", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unsupported"));
    assert(await didContractThrow(centralizedOracle.requestPrice(identifierBytes, 10)));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, 10)));
    assert(await didContractThrow(centralizedOracle.hasPrice(identifierBytes, 10)));
  });

  it("Unregistered Derivative", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unregistered"));

    // Configure the oracle to support the identifiers used in this test, as an owner.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Unregisterd derivatives cannot request prices.
    assert(await didContractThrow(centralizedOracle.requestPrice(identifierBytes, 10, { from: rando })));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, 10, { from: rando })));
    assert(await didContractThrow(centralizedOracle.hasPrice(identifierBytes, 10, { from: rando })));

    // Register the derivative with the registry.
    await registry.registerDerivative([], rando, { from: creator });

    // Now that the derivative is registered, the price request should work.
    await centralizedOracle.requestPrice(identifierBytes, 10, { from: rando });
    assert.isFalse(await centralizedOracle.hasPrice(identifierBytes, 10, { from: rando }));
  });
});
