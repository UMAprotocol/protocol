const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const SourceOracle = getContract("SourceOracle");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Bridge = getContract("Bridge");
const GenericHandler = getContract("GenericHandler");
const MockOracle = getContract("MockOracleAncillary");
const IdentifierWhitelist = getContract("IdentifierWhitelist");

const { utf8ToHex, hexToUtf8, padRight } = web3.utils;

const { blankFunctionSig, createGenericDepositData } = require("./helpers");

describe("SourceOracle", async () => {
  let accounts;
  let owner;
  let rando;

  let voting;
  let sourceOracle;
  let registry;
  let finder;
  let bridge;
  let handler;
  let identifierWhitelist;

  const chainID = 1;
  const destinationChainID = 2;
  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";
  const expectedDepositNonce = 1;

  let sourceOracleResourceId;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(testIdentifier).send({ from: accounts[0] });
    finder = await Finder.deployed();
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: accounts[0] });
  });

  beforeEach(async function () {
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.options.address)
      .send({ from: accounts[0] });
    sourceOracle = await SourceOracle.new(finder.options.address, chainID).send({ from: accounts[0] });
    sourceOracleResourceId = await sourceOracle.methods.getResourceId().call();
    handler = await GenericHandler.new(
      bridge.options.address,
      [sourceOracleResourceId],
      [sourceOracle.options.address],
      [blankFunctionSig],
      [blankFunctionSig]
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.options.address)
      .send({ from: accounts[0] });
    await bridge.methods
      .adminSetGenericResource(
        handler.options.address,
        sourceOracleResourceId,
        sourceOracle.options.address,
        blankFunctionSig,
        blankFunctionSig
      )
      .send({ from: owner });

    // Pre-publish price on MockOracle so we can publish prices on the SourceOracle:
    voting = await MockOracle.new(finder.options.address, ZERO_ADDRESS).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), voting.options.address)
      .send({ from: accounts[0] });
    await voting.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: accounts[0] });
  });
  describe("Requesting a price on Source Oracle", function () {
    beforeEach(async function () {
      // Need to request a price first on the source oracle before we can publish:
      await finder.methods
        .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), rando)
        .send({ from: accounts[0] });
      await sourceOracle.methods
        .executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
        .send({ from: rando });
      await finder.methods
        .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.options.address)
        .send({ from: accounts[0] });
    });
    it("publishPrice: should call Bridge.deposit", async function () {
      assert(
        await didContractThrow(
          sourceOracle.methods
            .publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
            .send({ from: owner })
        ),
        "can only publish once price is resolved on mock oracle"
      );

      await voting.methods
        .pushPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
        .send({ from: accounts[0] });

      const txn = await sourceOracle.methods
        .publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
        .send({ from: owner });
      await assertEventEmitted(
        txn,
        sourceOracle,
        "PushedPrice",
        (event) =>
          event.chainID.toString() === destinationChainID.toString() &&
          hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
          event.time.toString() === testRequestTime.toString() &&
          event.ancillaryData.toLowerCase() === testAncillary.toLowerCase() &&
          event.price.toString() === testPrice.toString()
      );

      // Deposit event will be emitted after successful Bridge.deposit() internal call if the resource ID is set up
      // properly.
      await assertEventEmitted(
        txn,
        bridge,
        "Deposit",
        (event) =>
          event.destinationChainID.toString() === destinationChainID.toString() &&
          event.resourceID.toLowerCase() === sourceOracleResourceId.toLowerCase() &&
          event.depositNonce.toString() === expectedDepositNonce.toString()
      );
      // Repeat call should fail:
      assert(
        await didContractThrow(
          sourceOracle.methods
            .publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
            .send({ from: owner })
        ),
        "can only publish price once"
      );
    });
    it("validateDeposit", async function () {
      assert(
        await didContractThrow(
          sourceOracle.methods
            .validateDeposit(destinationChainID, testIdentifier, testRequestTime, testAncillary, testPrice)
            .send({ from: accounts[0] })
        ),
        "Reverts if price not published yet"
      );
      await voting.methods
        .pushPrice(testIdentifier, testRequestTime, testAncillary, testPrice)
        .send({ from: accounts[0] });
      await sourceOracle.methods
        .publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
        .send({ from: owner });
      await sourceOracle.methods
        .validateDeposit(destinationChainID, testIdentifier, testRequestTime, testAncillary, testPrice)
        .send({ from: accounts[0] });
      assert(
        await didContractThrow(
          sourceOracle.methods
            .validateDeposit(destinationChainID, testIdentifier, testRequestTime, testAncillary, testPrice)
            .send({ from: accounts[0] })
        ),
        "Should not be able to call validateDeposit again."
      );
    });
  });
  it("executeRequestPrice", async function () {
    assert(
      await didContractThrow(
        sourceOracle.methods
          .executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
          .send({ from: rando })
      ),
      "Only callable by GenericHandler"
    );
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), rando)
      .send({ from: accounts[0] });
    const txn = await sourceOracle.methods
      .executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
      .send({ from: rando });
    await assertEventEmitted(
      txn,
      sourceOracle,
      "PriceRequestAdded",
      (event) =>
        event.chainID.toString() === destinationChainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
    assert(
      await didContractThrow(
        sourceOracle.methods
          .executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary)
          .send({ from: accounts[0] })
      ),
      "Should not be able to call executeRequestPrice again."
    );
  });
  it("formatMetadata", async function () {
    const metadata = await sourceOracle.methods
      .formatMetadata(chainID, testIdentifier, testRequestTime, testAncillary, testPrice)
      .call();
    const encoded = web3.eth.abi.encodeParameters(
      ["uint8", "bytes32", "uint256", "bytes", "int256"],
      [chainID, padRight(testIdentifier, 64), testRequestTime, testAncillary, testPrice]
    );
    const formattedEncoded = createGenericDepositData(encoded);
    assert.equal(metadata, formattedEncoded);
  });
});
