const hre = require("hardhat");
const { runDefaultFixture, didContractThrow } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { assert } = require("chai");
const OracleBase = getContract("OracleBaseMock");
const Finder = getContract("Finder");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

describe("OracleBase", async () => {
  let accounts;
  let owner;

  let oracle;
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
    oracle = await OracleBase.new(finder.options.address).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await oracle.methods.finder().call(), finder.options.address, "finder address not set");
  });
  it("requestPrice", async function () {
    // Cannot set ancillary data size too large:
    const DATA_LIMIT_BYTES = 8192; // Max ancillary data length allowed by OracleBase:
    let largeAncillaryData = web3.utils.randomHex(DATA_LIMIT_BYTES + 1);
    assert(
      await didContractThrow(
        oracle.methods.requestPrice(testIdentifier, testRequestTime, largeAncillaryData).send({ from: owner })
      )
    );

    // New price request returns true and emits event.
    assert.equal(await oracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).call(), true);
    let txn = await oracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await assertEventEmitted(
      txn,
      oracle,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );

    // Duplicate call does not emit an event and returns false.
    assert.equal(await oracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).call(), false);
    txn = await oracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await assertEventNotEmitted(txn, oracle, "PriceRequestAdded");
  });
  it("publishPrice", async function () {
    let txn = await oracle.methods
      .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
      .send({ from: owner });
    await assertEventEmitted(
      txn,
      oracle,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );

    // Duplicate call does not emit an event.
    txn = await oracle.methods
      .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
      .send({ from: owner });
    await assertEventNotEmitted(txn, oracle, "PushedPrice");
  });
  it("encodePriceRequest", async function () {
    const encodedPrice = await oracle.methods.encodePriceRequest(testIdentifier, testRequestTime, testAncillary).call();
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
});
