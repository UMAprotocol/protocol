const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const OracleBaseTunnel = artifacts.require("OracleBaseTunnelMock");
const Finder = artifacts.require("Finder");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

contract("OracleBaseTunnel", async (accounts) => {
  const owner = accounts[0];

  let tunnel;
  let finder;

  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";

  beforeEach(async function () {
    finder = await Finder.deployed();
    tunnel = await OracleBaseTunnel.new(finder.address);
  });
  it("construction", async function () {
    assert.equal(await tunnel.finder(), finder.address, "finder address not set");
  });
  it("requestPrice", async function () {
    let txn = await tunnel.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: owner });
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
    // Duplicate call does not emit an event.
    txn = await tunnel.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: owner });
    TruffleAssert.eventNotEmitted(
      txn,
      "PriceRequestAdded"
    );
  });
  it("publishPrice", async function () {
    await tunnel.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: owner });
    let txn = await tunnel.publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice, {
      from: owner,
    });
    TruffleAssert.eventEmitted(
      txn,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );
    // Duplicate call does not emit an event.
    txn = await tunnel.publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice, { from: owner });
    TruffleAssert.eventNotEmitted(
      txn,
      "PushedPrice"
    );
  });
  it("encodePriceRequest", async function () {
    const encodedPrice = await tunnel.encodePriceRequest(testIdentifier, testRequestTime, testAncillary);
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
});
