const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const { didContractThrow, interfaceName } = require("@uma/common");
const BeaconOracle = artifacts.require("BeaconOracleMock");
const Finder = artifacts.require("Finder");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

contract("BeaconOracle", async accounts => {
  let beaconOracle;
  let finder;

  const chainID = 1;
  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";

  beforeEach(async function() {
    finder = await Finder.deployed();
    beaconOracle = await BeaconOracle.new(finder.address, chainID);
  });
  it("construction", async function() {
    assert.equal(await beaconOracle.finder(), finder.address, "finder address not set");
    assert.equal(await beaconOracle.chainID(), chainID.toString(), "chain ID not set");
  });
  it("requestPrice", async function() {
    const txn = await beaconOracle.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: accounts[0] });
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      event =>
        event.requester.toLowerCase() === accounts[0].toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
    assert.isFalse(
      await beaconOracle.hasPrice(testIdentifier, testRequestTime, testAncillary),
      "should not have price after request"
    );
    assert(
      await didContractThrow(beaconOracle.getPrice(testIdentifier, testRequestTime, testAncillary)),
      "should revert after request price"
    );
  });
  it("publishPrice", async function() {
    await beaconOracle.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: accounts[0] });
    const txn = await beaconOracle.publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice, {
      from: accounts[0]
    });
    TruffleAssert.eventEmitted(
      txn,
      "PushedPrice",
      event =>
        event.pusher.toLowerCase() === accounts[0].toLowerCase() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );
    assert.isTrue(
      await beaconOracle.hasPrice(testIdentifier, testRequestTime, testAncillary),
      "should have price after publish"
    );
    assert.equal(
      (await beaconOracle.getPrice(testIdentifier, testRequestTime, testAncillary)).toString(),
      testPrice,
      "should not revert after publish"
    );
    assert(
      await didContractThrow(beaconOracle.requestPrice(testIdentifier, testRequestTime, testAncillary)),
      "cannot request already published price"
    );
  });
  it("encodePriceRequest", async function() {
    const encodedPrice = await beaconOracle.encodePriceRequest(testIdentifier, testRequestTime, testAncillary);
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
  it("getBridge", async function() {
    // Point Finder "Bridge" to arbitrary contract:
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), beaconOracle.address);
    assert.equal(
      await beaconOracle.getBridge(),
      beaconOracle.address,
      "getBridge doesn't point to correct Bridge set in Finder"
    );
  });
});
