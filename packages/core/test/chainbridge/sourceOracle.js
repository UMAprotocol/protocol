const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const SourceOracle = artifacts.require("SourceOracle");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Bridge = artifacts.require("Bridge");
const GenericHandler = artifacts.require("GenericHandler");
const MockOracle = artifacts.require("MockOracleAncillary");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

const { utf8ToHex, hexToUtf8, padRight } = web3.utils;

const { blankFunctionSig, createGenericDepositData } = require("./helpers");

contract("SourceOracle", async (accounts) => {
  const owner = accounts[0];
  const rando = accounts[1];

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

  beforeEach(async function () {
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(testIdentifier);
    finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.address);
    sourceOracle = await SourceOracle.new(finder.address, chainID);
    sourceOracleResourceId = await sourceOracle.getResourceId();
    handler = await GenericHandler.new(
      bridge.address,
      [sourceOracleResourceId],
      [sourceOracle.address],
      [blankFunctionSig],
      [blankFunctionSig]
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.address);
    await bridge.adminSetGenericResource(
      handler.address,
      sourceOracleResourceId,
      sourceOracle.address,
      blankFunctionSig,
      blankFunctionSig,
      { from: owner }
    );

    // Pre-publish price on MockOracle so we can publish prices on the SourceOracle:
    voting = await MockOracle.new(finder.address, ZERO_ADDRESS);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), voting.address);
    await voting.requestPrice(testIdentifier, testRequestTime, testAncillary);
  });
  describe("Requesting a price on Source Oracle", function () {
    beforeEach(async function () {
      // Need to request a price first on the source oracle before we can publish:
      await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), rando);
      await sourceOracle.executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, {
        from: rando,
      });
      await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.address);
    });
    it("publishPrice: should call Bridge.deposit", async function () {
      assert(
        await didContractThrow(
          sourceOracle.publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, { from: owner })
        ),
        "can only publish once price is resolved on mock oracle"
      );

      await voting.pushPrice(testIdentifier, testRequestTime, testAncillary, testPrice);

      const txn = await sourceOracle.publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, {
        from: owner,
      });
      TruffleAssert.eventEmitted(
        txn,
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
      const internalTxn = await TruffleAssert.createTransactionResult(bridge, txn.tx);
      TruffleAssert.eventEmitted(
        internalTxn,
        "Deposit",
        (event) =>
          event.destinationChainID.toString() === destinationChainID.toString() &&
          event.resourceID.toLowerCase() === sourceOracleResourceId.toLowerCase() &&
          event.depositNonce.toString() === expectedDepositNonce.toString()
      );
      // Repeat call should fail:
      assert(
        await didContractThrow(
          sourceOracle.publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, { from: owner })
        ),
        "can only publish price once"
      );
    });
    it("validateDeposit", async function () {
      assert(
        await didContractThrow(
          sourceOracle.validateDeposit(destinationChainID, testIdentifier, testRequestTime, testAncillary, testPrice)
        ),
        "Reverts if price not published yet"
      );
      await voting.pushPrice(testIdentifier, testRequestTime, testAncillary, testPrice);
      await sourceOracle.publishPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, {
        from: owner,
      });
      await sourceOracle.validateDeposit(destinationChainID, testIdentifier, testRequestTime, testAncillary, testPrice);
      assert(
        await didContractThrow(
          sourceOracle.validateDeposit(destinationChainID, testRequestTime, testAncillary, testPrice)
        ),
        "Should not be able to call validateDeposit again."
      );
    });
  });
  it("executeRequestPrice", async function () {
    assert(
      await didContractThrow(
        sourceOracle.executeRequestPrice(destinationChainID, testIdentifier, testRequestTime, testAncillary, {
          from: rando,
        })
      ),
      "Only callable by GenericHandler"
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), rando);
    const txn = await sourceOracle.executeRequestPrice(
      destinationChainID,
      testIdentifier,
      testRequestTime,
      testAncillary,
      { from: rando }
    );
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        event.chainID.toString() === destinationChainID.toString() &&
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testRequestTime.toString() &&
        event.ancillaryData.toLowerCase() === testAncillary.toLowerCase()
    );
    assert(
      await didContractThrow(
        sourceOracle.executeRequestPrice(destinationChainID, testRequestTime, testAncillary, testPrice),
        { from: rando }
      ),
      "Should not be able to call executeRequestPrice again."
    );
  });
  it("formatMetadata", async function () {
    const metadata = await sourceOracle.formatMetadata(
      chainID,
      testIdentifier,
      testRequestTime,
      testAncillary,
      testPrice
    );
    const encoded = web3.eth.abi.encodeParameters(
      ["uint8", "bytes32", "uint256", "bytes", "int256"],
      [chainID, padRight(testIdentifier, 64), testRequestTime, testAncillary, testPrice]
    );
    const formattedEncoded = createGenericDepositData(encoded);
    assert.equal(metadata, formattedEncoded);
  });
});
