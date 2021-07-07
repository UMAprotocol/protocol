const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { assert } = require("chai");
const OracleBaseTunnel = getContract("OracleBaseTunnelMock");
const Finder = getContract("Finder");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

describe("OracleBaseTunnel", async () => {
  let accounts;
  let owner;

  let tunnel;
  let finder;

  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
  });
  beforeEach(async function () {
    tunnel = await OracleBaseTunnel.new(finder.options.address).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await tunnel.methods.finder().call(), finder.options.address, "finder address not set");
  });
  it("requestPrice", async function () {
    let txn = await tunnel.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await assertEventEmitted(
      txn,
      tunnel,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
    // Duplicate call does not emit an event.
    txn = await tunnel.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await assertEventNotEmitted(txn, tunnel, "PriceRequestAdded");
  });
  it("publishPrice", async function () {
    await tunnel.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    let txn = await tunnel.methods
      .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
      .send({ from: owner });
    await assertEventEmitted(
      txn,
      tunnel,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );
    // Duplicate call does not emit an event.
    txn = await tunnel.methods
      .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
      .send({ from: owner });
    await assertEventNotEmitted(txn, tunnel, "PushedPrice");
  });
  it("encodePriceRequest", async function () {
    const encodedPrice = await tunnel.methods.encodePriceRequest(testIdentifier, testRequestTime, testAncillary).call();
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
});
