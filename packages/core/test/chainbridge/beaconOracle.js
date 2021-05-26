const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const BeaconOracle = artifacts.require("BeaconOracleMock");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

contract("BeaconOracle", async (accounts) => {
  const owner = accounts[0];

  let beaconOracle;
  let finder;
  let registry;

  const chainID = 1;
  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";

  before(async function () {
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    // Register EOA as a contract creator that can access price information from BeaconOracle.
    await registry.registerContract([], owner, { from: owner });
  });
  beforeEach(async function () {
    finder = await Finder.deployed();
    beaconOracle = await BeaconOracle.new(finder.address, chainID);
  });
  it("construction", async function () {
    assert.equal(await beaconOracle.finder(), finder.address, "finder address not set");
    assert.equal(await beaconOracle.currentChainID(), chainID.toString(), "chain ID not set");
  });
  it("requestPrice", async function () {
    const txn = await beaconOracle.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: owner });
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        event.requester.toLowerCase() === owner.toLowerCase() &&
        event.chainID.toString() === chainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
  });
  it("publishPrice", async function () {
    await beaconOracle.requestPrice(testIdentifier, testRequestTime, testAncillary, { from: owner });
    const txn = await beaconOracle.publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice, {
      from: owner,
    });
    TruffleAssert.eventEmitted(
      txn,
      "PushedPrice",
      (event) =>
        event.pusher.toLowerCase() === owner.toLowerCase() &&
        event.chainID.toString() === chainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );
    assert(
      await didContractThrow(beaconOracle.publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)),
      "Cannot publish price more than once"
    );
  });
  it("encodePriceRequest", async function () {
    const encodedPrice = await beaconOracle.encodePriceRequest(testIdentifier, testRequestTime, testAncillary);
    const encoded = web3.eth.abi.encodeParameters(
      ["uint8", "bytes32", "uint256", "bytes"],
      [chainID, padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
  it("getBridge", async function () {
    // Point Finder "Bridge" to arbitrary contract:
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), beaconOracle.address);
    assert.equal(
      await beaconOracle.getBridge(),
      beaconOracle.address,
      "getBridge doesn't point to correct Bridge set in Finder"
    );
  });
});
