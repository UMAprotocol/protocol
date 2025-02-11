const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { web3 } = hre;
const { getContract, assertEventEmitted } = hre;
const { RegistryRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;

const FxChild = getContract("FxChildMock");
const OracleChildTunnel = getContract("OracleChildTunnel");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

const testIdentifier = utf8ToHex("TEST");
const testTimestamp = 100;
const testPrice = toWei("0.5");
const stateId = "1";

const compressAncillaryBytesThreshold = 256;
const shortAncillaryData = utf8ToHex("x".repeat(compressAncillaryBytesThreshold));
const longAncillaryData = utf8ToHex("x".repeat(compressAncillaryBytesThreshold + 1));

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

  it("stampOrCompressAncillaryData", async function () {
    // For short ancillary data only requester and chain id should be added.
    const blockNumber = await web3.eth.getBlockNumber();
    const stampedAncillaryData = await oracleChild.methods
      .stampOrCompressAncillaryData(shortAncillaryData, owner, blockNumber)
      .call();
    const chainId = await web3.eth.getChainId();
    assert.equal(
      hexToUtf8(stampedAncillaryData),
      `${hexToUtf8(shortAncillaryData)},childRequester:${owner.slice(2).toLowerCase()},childChainId:${chainId}`
    );

    // Longer ancillary data should be compressed to a hash and include block number, spoke, requester and chain id.
    const compressedData = await oracleChild.methods
      .stampOrCompressAncillaryData(longAncillaryData, owner, blockNumber)
      .call();
    const ancillaryDataHash = web3.utils.sha3(longAncillaryData);
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

  it("migrated requests", async function () {
    // Resolving of requests initiated from the previous implementation should be supported automatically since the
    // derivation of request hash is the same where requester and chain id are appended to ancillary data.
    const publishPrice = async (ancillaryData) => {
      const chainId = await web3.eth.getChainId();
      const parentAncillaryData = utf8ToHex(
        `${hexToUtf8(ancillaryData)},childRequester:${owner.slice(2).toLowerCase()},childChainId:${chainId}`
      );
      const fxChildData = web3.eth.abi.encodeParameters(
        ["address", "address", "bytes"],
        [
          ZERO_ADDRESS, // Root tunnel is not initialized for these tests.
          oracleChild.options.address,
          web3.eth.abi.encodeParameters(
            ["bytes32", "uint256", "bytes", "int256"],
            [testIdentifier, testTimestamp, parentAncillaryData, testPrice]
          ),
        ]
      );
      const publishPriceTx = await fxChild.methods.onStateReceive(stateId, fxChildData).send({ from: systemSuperUser });
      const requestId = web3.utils.keccak256(
        web3.eth.abi.encodeParameters(
          ["bytes32", "uint256", "bytes"],
          [testIdentifier, testTimestamp, parentAncillaryData]
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
          event.ancillaryData.toLowerCase() === parentAncillaryData.toLowerCase() &&
          event.price.toString() === testPrice &&
          event.requestHash === requestId
      );
    };

    // Publish prices to child chain both for short and long ancillary data.
    await publishPrice(shortAncillaryData);
    await publishPrice(longAncillaryData);

    // getPrice should return the price as the legacy requests were resolved.
    assert.equal(
      await oracleChild.methods.getPrice(testIdentifier, testTimestamp, shortAncillaryData).call({ from: owner }),
      testPrice
    );
    assert.equal(
      await oracleChild.methods.getPrice(testIdentifier, testTimestamp, longAncillaryData).call({ from: owner }),
      testPrice
    );
  });
});
