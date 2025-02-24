const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { web3 } = hre;
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { RegistryRolesEnum, ZERO_ADDRESS, didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;

const FxChild = getContract("FxChildMock");
const OracleChildTunnel = getContract("OracleChildTunnel");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

const testIdentifier = utf8ToHex("TEST");
const testTimestamp = 100;
const testAncillaryData = utf8ToHex("key:value");
const testPrice = toWei("0.5");
const stateId = "1";

describe("OracleChildTunnel", async () => {
  let accounts;
  let owner;
  let systemSuperUser;

  let fxChild;
  let oracleChild;

  // Oracle system:
  let finder;
  let registry;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, systemSuperUser] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    registry = await Registry.deployed();

    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });
  });

  beforeEach(async function () {
    fxChild = await FxChild.new(systemSuperUser).send({ from: accounts[0] });

    oracleChild = await OracleChildTunnel.new(fxChild.options.address, finder.options.address).send({
      from: accounts[0],
    });
  });

  it("compressAncillaryData", async function () {
    // Ancillary data should be compressed to a hash and include block number, spoke, requester and chain id.
    const chainId = await web3.eth.getChainId();
    const blockNumber = await web3.eth.getBlockNumber();
    const compressedData = await oracleChild.methods
      .compressAncillaryData(testAncillaryData, owner, blockNumber)
      .call();
    const ancillaryDataHash = web3.utils.sha3(testAncillaryData);
    const childBlockNumber = await web3.eth.getBlockNumber();
    assert.equal(
      hexToUtf8(compressedData),
      `ancillaryDataHash:${ancillaryDataHash.slice(
        2
      )},childBlockNumber:${childBlockNumber},childOracle:${oracleChild.options.address
        .slice(2)
        .toLowerCase()},childRequester:${owner.slice(2).toLowerCase()},childChainId:${chainId}`
    );
  });

  it("resolveLegacyRequest", async function () {
    // Reverts as price not yet available
    assert(
      await didContractThrow(
        oracleChild.methods
          .resolveLegacyRequest(testIdentifier, testTimestamp, testAncillaryData, owner)
          .send({ from: owner })
      )
    );

    const chainId = await web3.eth.getChainId();
    const legacyAncillaryData = utf8ToHex(
      `${hexToUtf8(testAncillaryData)},childRequester:${owner.slice(2).toLowerCase()},childChainId:${chainId}`
    );
    const fxChildData = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes"],
      [
        ZERO_ADDRESS, // Root tunnel is not initialized for these tests.
        oracleChild.options.address,
        web3.eth.abi.encodeParameters(
          ["bytes32", "uint256", "bytes", "int256"],
          [testIdentifier, testTimestamp, legacyAncillaryData, testPrice]
        ),
      ]
    );
    const publishPriceTx = await fxChild.methods.onStateReceive(stateId, fxChildData).send({ from: systemSuperUser });
    const legacyRequestHash = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [testIdentifier, testTimestamp, legacyAncillaryData]
      )
    );

    // Price should be pushed even if the request was not initiated from the current implementation.
    await assertEventEmitted(
      publishPriceTx,
      oracleChild,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === legacyAncillaryData.toLowerCase() &&
        event.price.toString() === testPrice &&
        event.requestHash === legacyRequestHash
    );

    // Encoding of request ID was different in the legacy contract so getPrice will revert even though price was pushed.
    assert(
      await didContractThrow(
        oracleChild.methods.getPrice(testIdentifier, testTimestamp, testAncillaryData).call({ from: owner })
      )
    );

    // Requester is now passed when deriving the request hash.
    const requestHash = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["address", "bytes32", "uint256", "bytes"],
        [owner, testIdentifier, testTimestamp, testAncillaryData]
      )
    );
    let resolveLegactTx = await oracleChild.methods
      .resolveLegacyRequest(testIdentifier, testTimestamp, testAncillaryData, owner)
      .send({ from: owner });
    await assertEventEmitted(
      resolveLegactTx,
      oracleChild,
      "ResolvedLegacyRequest",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === testAncillaryData.toLowerCase() &&
        event.price.toString() === testPrice &&
        event.requestHash === requestHash &&
        event.legacyRequestHash === legacyRequestHash
    );

    // getPrice should now return the price as the legacy request was resolved.
    assert.equal(
      await oracleChild.methods.getPrice(testIdentifier, testTimestamp, testAncillaryData).call({ from: owner }),
      testPrice
    );

    // Duplicate call does not emit an event.
    resolveLegactTx = await oracleChild.methods
      .resolveLegacyRequest(testIdentifier, testTimestamp, testAncillaryData, owner)
      .send({ from: owner });
    await assertEventNotEmitted(resolveLegactTx, oracleChild, "ResolvedLegacyRequest");
  });
});
