const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const NoLeverage = artifacts.require("NoLeverage");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const BigNumber = require("bignumber.js");

contract("CentralizedOracle", function(accounts) {
  // A deployed instance of the CentralizedOracle contract, ready for testing.
  let centralizedOracle;

  const owner = accounts[0];
  const rando = accounts[1];

  const oraclePriceDelay = 60 * 60 * 24 * 7;

  before(async function() {
    centralizedOracle = await CentralizedOracle.deployed();
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

    // Enqueue the request for a price, and verify that `timeForPrice`=0.
    let currentTime = 100;
    await centralizedOracle.setCurrentTime(currentTime);
    let getPriceResult = await centralizedOracle.getPrice.call(identifierBytes, firstTime);
    await centralizedOracle.getPrice(identifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, 0);
    assert.equal(getPriceResult.verifiedTime, currentTime + oraclePriceDelay);

    // Check that the query is pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);

    // Enqueue the second request for a price, and verify that `timeForPrice`=0.
    currentTime = 5000;
    await centralizedOracle.setCurrentTime(currentTime);
    getPriceResult = await centralizedOracle.getPrice.call(identifierBytes, secondTime);
    await centralizedOracle.getPrice(identifierBytes, secondTime);
    assert.equal(getPriceResult.timeForPrice, 0);
    assert.equal(getPriceResult.verifiedTime, currentTime + oraclePriceDelay);

    // Check that both queries are pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 2);

    // Push a price for the first identifier.
    const firstPricePushTime = 10000;
    await centralizedOracle.setCurrentTime(firstPricePushTime);
    await centralizedOracle.pushPrice(identifierBytes, firstTime, price);

    // Get first price.
    getPriceResult = await centralizedOracle.getPrice.call(identifierBytes, firstTime);
    await centralizedOracle.getPrice(identifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, firstTime);
    assert.equal(getPriceResult.price, price);
    assert.equal(getPriceResult.verifiedTime, firstPricePushTime);

    // Check that the second query is pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);

    // Push a price for the second identifier.
    const secondPricePushTime = 20000;
    await centralizedOracle.setCurrentTime(secondPricePushTime);
    await centralizedOracle.pushPrice(identifierBytes, secondTime, price);

    // Get second price.
    getPriceResult = await centralizedOracle.getPrice.call(identifierBytes, secondTime);
    await centralizedOracle.getPrice(identifierBytes, secondTime);
    assert.equal(getPriceResult.timeForPrice, secondTime);
    assert.equal(getPriceResult.price, price);
    assert.equal(getPriceResult.verifiedTime, secondPricePushTime);

    // Get the first price again, just to double check.
    getPriceResult = await centralizedOracle.getPrice.call(identifierBytes, firstTime);
    await centralizedOracle.getPrice(identifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, firstTime);
    assert.equal(getPriceResult.price, price);
    assert.equal(getPriceResult.verifiedTime, firstPricePushTime);
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

    // Enqueue the request for a price, and verify that `timeForPrice`=0.
    let getPriceResult = await centralizedOracle.getPrice.call(firstIdentifierBytes, firstTime);
    await centralizedOracle.getPrice(firstIdentifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, 0);

    // Check that the query is pending
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);
    assert.equal(pendingQueries[0].time, firstTime);

    // Enqueue a second request for a price, and verify that `timeForPrice`=0.
    getPriceResult = await centralizedOracle.getPrice.call(secondIdentifierBytes, secondTime);
    await centralizedOracle.getPrice(secondIdentifierBytes, secondTime);
    assert.equal(getPriceResult.timeForPrice, 0);

    // Check that both queries are pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 2);

    // Prices are still not available, until a price is pushed.
    getPriceResult = await centralizedOracle.getPrice.call(firstIdentifierBytes, firstTime);
    await centralizedOracle.getPrice(firstIdentifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, 0);
    getPriceResult = await centralizedOracle.getPrice.call(secondIdentifierBytes, secondTime);
    await centralizedOracle.getPrice(secondIdentifierBytes, secondTime);
    assert.equal(getPriceResult.timeForPrice, 0);

    // Push a price for the second identifier.
    await centralizedOracle.pushPrice(secondIdentifierBytes, secondTime, secondPrice);

    // Price should now be available.
    getPriceResult = await centralizedOracle.getPrice.call(secondIdentifierBytes, secondTime);
    await centralizedOracle.getPrice(secondIdentifierBytes, secondTime);
    assert.equal(getPriceResult.timeForPrice, secondTime);
    assert.equal(getPriceResult.price, secondPrice);

    // First request is still pending.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 1);
    assert.equal(pendingQueries[0].time, firstTime);

    // Push a price for the first identifier.
    await centralizedOracle.pushPrice(firstIdentifierBytes, firstTime, firstPrice);

    // Price should now be available.
    getPriceResult = await centralizedOracle.getPrice.call(firstIdentifierBytes, firstTime);
    await centralizedOracle.getPrice(firstIdentifierBytes, firstTime);
    assert.equal(getPriceResult.timeForPrice, firstTime);
    assert.equal(getPriceResult.price, firstPrice);

    // No pending queries.
    pendingQueries = await centralizedOracle.getPendingQueries();
    assert.equal(pendingQueries.length, 0);
  });

  it("Admin", async function() {
    // Initialize a TokenizedDerivative for this test case.
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Admin"));
    const manualPriceFeed = await ManualPriceFeed.deployed();
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const noLeverageCalculator = await NoLeverage.deployed();

    await centralizedOracle.addSupportedIdentifier(identifierBytes);
    await manualPriceFeed.setCurrentTime(500);
    await manualPriceFeed.pushLatestPrice(identifierBytes, 450, web3.utils.toWei("1", "ether"));

    const constructorParams = {
      sponsor: owner,
      admin: centralizedOracle.address,
      defaultPenalty: web3.utils.toWei("0.05", "ether"),
      requiredMargin: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
      disputeDeposit: web3.utils.toWei("0.05", "ether"),
      returnCalculator: noLeverageCalculator.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: "0",
      marginCurrency: "0x0000000000000000000000000000000000000000",
      withdrawLimit: web3.utils.toWei("0.33", "ether")
    };
    await tokenizedDerivativeCreator.createTokenizedDerivative(constructorParams, { from: owner });
    const deployedRegistry = await Registry.deployed();
    const derivativeArray = await deployedRegistry.getRegisteredDerivatives(owner);
    const derivativeAddress = derivativeArray[derivativeArray.length - 1].derivativeAddress;
    const derivativeContract = await TokenizedDerivative.at(derivativeAddress);

    assert.equal(await derivativeContract.state(), "0");
    assert.equal((await derivativeContract.currentTokenState()).time, "450");

    // Only the owner of the Oracle can use these methods.
    assert(await didContractThrow(centralizedOracle.callEmergencyShutdown(derivativeContract, { from: rando })));
    assert(await didContractThrow(centralizedOracle.callRemargin(derivativeContract, { from: rando })));

    // Verify that the Oracle passes on remargin() to the derivative.
    await manualPriceFeed.pushLatestPrice(identifierBytes, 475, web3.utils.toWei("1", "ether"));
    await centralizedOracle.callRemargin(derivativeAddress);
    assert.equal((await derivativeContract.currentTokenState()).time, "475");

    // Verify that the Oracle passes on emergencyShutdown() to the derivative.
    await centralizedOracle.callEmergencyShutdown(derivativeAddress);
    assert.equal(await derivativeContract.state(), "4");
  });

  it("Non owner", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

    // Non-owners can't add supported identifiers.
    assert(await didContractThrow(centralizedOracle.addSupportedIdentifier(identifierBytes, { from: rando })));

    // Configure the oracle to support the identifiers used in this test, as an owner.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Request the price, which any contract can do (for now).
    await centralizedOracle.getPrice(identifierBytes, 10, { from: rando });

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

  it("Unsupported product", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unsupported"));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, 10)));
  });
});
