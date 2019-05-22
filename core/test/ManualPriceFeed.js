const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const BigNumber = require("bignumber.js");

contract("ManualPriceFeed", function(accounts) {
  // A deployed instance of the ManualPriceFeed contract, ready for testing.
  let manualPriceFeed;

  let owner = accounts[0];
  let rando = accounts[1];

  before(async function() {
    manualPriceFeed = await ManualPriceFeed.new(true);
  });

  it("No prices > One price > Updated price", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Identifier"));

    // No prices have been published, so the identifier is not yet supported.
    let supported = await manualPriceFeed.isIdentifierSupported(identifierBytes);
    assert.equal(supported, false);

    // No prices have been published, so latest `publishTime` is 0.
    assert(await didContractThrow(manualPriceFeed.latestPrice(identifierBytes)));

    // Push a price at time=100, and the identifier should now be supported.
    await manualPriceFeed.pushLatestPrice(identifierBytes, 100, 500);
    supported = await manualPriceFeed.isIdentifierSupported(identifierBytes);
    assert.equal(supported, true);

    // `latestPrice` should retrieve the price at time=100.
    actualPriceTick = await manualPriceFeed.latestPrice(identifierBytes);
    assert.equal(actualPriceTick.publishTime, 100);
    assert.equal(actualPriceTick.price, 500);

    // Push an updated price at time=200.
    await manualPriceFeed.pushLatestPrice(identifierBytes, 200, 1000);

    // `latestPrice` should retrieve the price at time=200.
    actualPriceTick = await manualPriceFeed.latestPrice(identifierBytes);
    assert.equal(actualPriceTick.publishTime, 200);
    assert.equal(actualPriceTick.price, 1000);
  });

  it("Multiple identifiers", async function() {
    const firstIdentifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("First"));
    const secondIdentifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Second"));
    const absentIdentifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Absent"));

    // Verify that all identifiers start off unsupported.
    let firstIdentifierSupported = await manualPriceFeed.isIdentifierSupported(firstIdentifierBytes);
    let secondIdentifierSupported = await manualPriceFeed.isIdentifierSupported(secondIdentifierBytes);
    let absentIdentifierSupported = await manualPriceFeed.isIdentifierSupported(absentIdentifierBytes);
    assert.equal(firstIdentifierSupported, false);
    assert.equal(secondIdentifierSupported, false);
    assert.equal(absentIdentifierSupported, false);

    // And all latestPrice calls revert because these identifiers are not supported.
    assert(await didContractThrow(manualPriceFeed.latestPrice(firstIdentifierBytes)));
    assert(await didContractThrow(manualPriceFeed.latestPrice(secondIdentifierBytes)));
    assert(await didContractThrow(manualPriceFeed.latestPrice(absentIdentifierBytes)));

    // Push a price for the first identifier.
    await manualPriceFeed.pushLatestPrice(firstIdentifierBytes, 100, 500);

    // Prices exist only for the first identifier.
    let firstIdentifierPriceTick = await manualPriceFeed.latestPrice(firstIdentifierBytes);
    assert.equal(firstIdentifierPriceTick.publishTime, 100);
    assert.equal(firstIdentifierPriceTick.price, 500);
    secondIdentifierSupported = await manualPriceFeed.isIdentifierSupported(secondIdentifierBytes);
    absentIdentifierSupported = await manualPriceFeed.isIdentifierSupported(absentIdentifierBytes);
    assert.equal(secondIdentifierSupported, false);
    assert.equal(absentIdentifierSupported, false);

    // Push a price for the second identifier.
    await manualPriceFeed.pushLatestPrice(secondIdentifierBytes, 200, 1000);

    // Distinct prices exist for the two identifiers, but the absentIdentifier is still unsupported.
    firstIdentifierPriceTick = await manualPriceFeed.latestPrice(firstIdentifierBytes);
    let secondIdentifierPriceTick = await manualPriceFeed.latestPrice(secondIdentifierBytes);
    assert.equal(firstIdentifierPriceTick.publishTime, 100);
    assert.equal(firstIdentifierPriceTick.price, 500);
    assert.equal(secondIdentifierPriceTick.publishTime, 200);
    assert.equal(secondIdentifierPriceTick.price, 1000);
    absentIdentifierSupported = await manualPriceFeed.isIdentifierSupported(absentIdentifierBytes);
    assert.equal(absentIdentifierSupported, false);
  });

  it("Non owner", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

    // Verify that the identifier is not supported yet.
    let supported = await manualPriceFeed.isIdentifierSupported(identifierBytes, { from: rando });
    assert.equal(supported, false);

    // Non-owners can't push prices.
    assert(await didContractThrow(manualPriceFeed.pushLatestPrice(identifierBytes, 100, 500, { from: rando })));

    await manualPriceFeed.pushLatestPrice(identifierBytes, 100, 500, { from: owner });

    // Verify that non-owners can still query prices.
    let priceTick = await manualPriceFeed.latestPrice(identifierBytes, { from: rando });
    assert.equal(priceTick.publishTime, 100);
    assert.equal(priceTick.price, 500);
  });

  it("Push non-consecutive prices", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Non-consecutive"));

    // Push an initial price.
    await manualPriceFeed.pushLatestPrice(identifierBytes, 100, 500);
    // Verify that a price earlier than the latest can't be pushed.
    assert(await didContractThrow(manualPriceFeed.pushLatestPrice(identifierBytes, 50, 500)));
  });

  it("Push a future price", async function() {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Future-price"));

    const tolerance = 900;
    const currentTime = 1000;
    await manualPriceFeed.setCurrentTime(currentTime);

    // Verify that a price later than the current time + tolerance can't be pushed.
    assert(await didContractThrow(manualPriceFeed.pushLatestPrice(identifierBytes, currentTime + tolerance + 1, 500)));

    // Verify that prices can be pushed within the tolerance.
    await manualPriceFeed.pushLatestPrice(identifierBytes, currentTime + tolerance, 500);
    let priceTick = await manualPriceFeed.latestPrice(identifierBytes);
    assert.equal(priceTick.publishTime, currentTime + tolerance);
    assert.equal(priceTick.price, 500);
  });
});
