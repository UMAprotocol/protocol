const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const Registry = artifacts.require("Registry");
const BigNumber = require("bignumber.js");

contract("CentralizedOracle", function(accounts) {
  // A deployed instance of the CentralizedOracle contract, ready for testing.
  let centralizedOracle;
  let registry;

  const owner = accounts[0];
  const rando = accounts[1];
  const creator = accounts[2];

  const oraclePriceDelay = 60 * 60 * 24 * 7;

  before(async function() {
    centralizedOracle = await CentralizedOracle.deployed();

    // Add creator and register owner as an approved derivative.
    registry = await Registry.deployed();
    await registry.addDerivativeCreator(creator, { from: owner });
    await registry.registerDerivative([], owner, { from: creator });
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

  it("Unsupported product", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unsupported"));
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, 10)));
  });

  it("Unregistered Derivative", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unregistered"));

    // Configure the oracle to support the identifiers used in this test, as an owner.
    await centralizedOracle.addSupportedIdentifier(identifierBytes);

    // Unregisterd derivatives cannot request prices.
    assert(await didContractThrow(centralizedOracle.getPrice(identifierBytes, 10, { from: rando })));

    // Register the derivative with the registry.
    await registry.registerDerivative([], rando, { from: creator });

    // Now that the derivative is registered, the price request should work.
    await centralizedOracle.getPrice(identifierBytes, 10, { from: rando });
  });
});
