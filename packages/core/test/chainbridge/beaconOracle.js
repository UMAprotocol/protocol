const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const BeaconOracle = getContract("BeaconOracleMock");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

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

  beforeEach(async function () {
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    // Register EOA as a contract creator that can access price information from BeaconOracle.
    await registry.methods.registerContract([], owner).send({ from: owner });
    finder = await Finder.deployed();
    beaconOracle = await BeaconOracle.new(finder.options.address, chainID).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await beaconOracle.methods.finder().call(), finder.options.address, "finder address not set");
    assert.equal(await beaconOracle.methods.currentChainID().call(), chainID.toString(), "chain ID not set");
  });
  it("requestPrice", async function () {
    const txn = await beaconOracle.methods
      .requestPrice(testIdentifier, testRequestTime, testAncillary)
      .call({ from: owner });
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        event.chainID.toString() === chainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
  });
  it("publishPrice", async function () {
    await beaconOracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    const txn = await beaconOracle.methods
      .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
      .call({ from: owner });
    TruffleAssert.eventEmitted(
      txn,
      "PushedPrice",
      (event) =>
        event.chainID.toString() === chainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
        event.price.toString() === testPrice
    );
    assert(
      await didContractThrow(
        beaconOracle.methods
          .publishPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
          .send({ from: accounts[0] })
      ),
      "Cannot publish price more than once"
    );
  });
  it("encodePriceRequest", async function () {
    const encodedPrice = await beaconOracle.methods
      .encodePriceRequest(testIdentifier, testRequestTime, testAncillary)
      .call();
    const encoded = web3.eth.abi.encodeParameters(
      ["uint8", "bytes32", "uint256", "bytes"],
      [chainID, padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const hash = sha3(encoded, { encoding: "hex " });
    assert.equal(hash, encodedPrice);
  });
  it("getBridge", async function () {
    // Point Finder "Bridge" to arbitrary contract:
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), beaconOracle.options.address);
    assert.equal(
      await beaconOracle.methods.getBridge().send({ from: accounts[0] }),
      beaconOracle.options.address,
      "getBridge doesn't point to correct Bridge set in Finder"
    );
  });
});
