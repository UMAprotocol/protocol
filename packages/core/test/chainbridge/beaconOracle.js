const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const BeaconOracle = getContract("BeaconOracleMock");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

const { utf8ToHex, hexToUtf8, sha3, padRight } = web3.utils;

describe("BeaconOracle", async () => {
  let accounts;
  let owner;

  let beaconOracle;
  let finder;
  let registry;

  const chainID = 1;
  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    // Register EOA as a contract creator that can access price information from BeaconOracle.
    await registry.methods.registerContract([], owner).send({ from: owner });
    finder = await Finder.deployed();
  });

  beforeEach(async function () {
    beaconOracle = await BeaconOracle.new(finder.options.address, chainID).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await beaconOracle.methods.finder().call(), finder.options.address, "finder address not set");
    assert.equal(await beaconOracle.methods.currentChainID().call(), chainID.toString(), "chain ID not set");
  });
  it("requestPrice", async function () {
    const txn = await beaconOracle.methods
      .requestPrice(testIdentifier, testRequestTime, testAncillary)
      .send({ from: owner });

    await assertEventEmitted(
      txn,
      beaconOracle,
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
      .send({ from: owner });
    await assertEventEmitted(
      txn,
      beaconOracle,
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
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Bridge), beaconOracle.options.address)
      .send({ from: accounts[0] });
    assert.equal(
      await beaconOracle.methods.getBridge().call(),
      beaconOracle.options.address,
      "getBridge doesn't point to correct Bridge set in Finder"
    );
  });
});
