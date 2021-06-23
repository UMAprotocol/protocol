const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const TruffleAssert = require("truffle-assertions");
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const SinkOracle = getContract("SinkOracle");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Bridge = getContract("Bridge");
const GenericHandler = getContract("GenericHandler");

const { utf8ToHex, hexToUtf8, padRight } = web3.utils;

const { blankFunctionSig, createGenericDepositData } = require("./helpers");

contract("SinkOracle", async (accounts) => {
  const owner = accounts[0];
  const rando = accounts[1];

  let sinkOracle;
  let registry;
  let finder;
  let bridge;
  let handler;

  const chainID = 1;
  const destinationChainID = 2;
  const testIdentifier = utf8ToHex("TEST-IDENTIFIER");
  const testAncillary = utf8ToHex("TEST-ANCILLARY");
  const testRequestTime = 123;
  const testPrice = "6";
  const expectedDepositNonce = 1;

  let sinkOracleResourceId;

  beforeEach(async function () {
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });
    finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address);
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100).send({ from: accounts[0] });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.options.address);
    sinkOracle = await SinkOracle.new(finder.options.address, chainID, destinationChainID).send({ from: accounts[0] });
    sinkOracleResourceId = await sinkOracle.methods.getResourceId().call();
    handler = await GenericHandler.new(
      bridge.options.address,
      [sinkOracleResourceId],
      [sinkOracle.options.address],
      [blankFunctionSig],
      [blankFunctionSig]
    ).send({ from: accounts[0] });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.options.address);
    await bridge.adminSetGenericResource(
      handler.options.address,
      sinkOracleResourceId,
      sinkOracle.options.address,
      blankFunctionSig,
      blankFunctionSig,
      { from: owner }
    );
  });
  it("construction", async function () {
    assert.equal(
      await sinkOracle.methods.destinationChainID().call(),
      destinationChainID.toString(),
      "destination chain ID not set"
    );
  });
  it("requestPrice: should call Bridge.deposit", async function () {
    assert(
      await didContractThrow(
        sinkOracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: rando })
      ),
      "Only callable by registered contract"
    );
    const txn = await sinkOracle.methods
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
    assert.isFalse(
      await sinkOracle.methods.hasPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner }),
      "should not have price after request"
    );
    assert(
      await didContractThrow(
        sinkOracle.methods.getPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner })
      ),
      "should revert after request price"
    );
    // Deposit event will be emitted after successful Bridge.deposit() internal call if the resource ID is set up
    // properly.
    const internalTxn = await TruffleAssert.createTransactionResult(bridge, txn.tx);
    TruffleAssert.eventEmitted(
      internalTxn,
      "Deposit",
      (event) =>
        event.destinationChainID.toString() === destinationChainID.toString() &&
        event.resourceID.toLowerCase() === sinkOracleResourceId.toLowerCase() &&
        event.depositNonce.toString() === expectedDepositNonce.toString()
    );
    // Calling requestPrice again should succeed but not call Bridge.deposit.
    const dupeTxn = await sinkOracle.methods
      .requestPrice(testIdentifier, testRequestTime, testAncillary)
      .call({ from: owner });
    TruffleAssert.eventNotEmitted(dupeTxn, "PriceRequestAdded");
    const internalDupeTxn = await TruffleAssert.createTransactionResult(bridge, dupeTxn.tx);
    TruffleAssert.eventNotEmitted(internalDupeTxn, "Deposit");
  });
  it("validateDeposit", async function () {
    assert(
      await didContractThrow(
        sinkOracle.methods
          .validateDeposit(chainID, testIdentifier, testRequestTime, testAncillary)
          .send({ from: accounts[0] })
      ),
      "Reverts if price not requested yet"
    );
    await sinkOracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await sinkOracle.methods
      .validateDeposit(chainID, testIdentifier, testRequestTime, testAncillary)
      .send({ from: accounts[0] });
    assert(
      await didContractThrow(
        sinkOracle.methods
          .validateDeposit(chainID, testIdentifier, testRequestTime, testAncillary)
          .send({ from: accounts[0] })
      ),
      "Should not be able to call validateDeposit again."
    );
  });
  it("executePublishPrice", async function () {
    await sinkOracle.methods.requestPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner });
    await sinkOracle.methods
      .validateDeposit(chainID, testIdentifier, testRequestTime, testAncillary)
      .send({ from: accounts[0] });
    assert(
      await didContractThrow(
        sinkOracle.methods
          .executePublishPrice(chainID, testIdentifier, testRequestTime, testAncillary, { from: rando })
          .send({ from: accounts[0] })
      ),
      "Only callable by GenericHandler"
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), rando);
    await sinkOracle.methods
      .executePublishPrice(chainID, testIdentifier, testRequestTime, testAncillary, testPrice)
      .send({ from: rando });
    assert(
      await didContractThrow(
        sinkOracle.methods.hasPrice(testIdentifier, testRequestTime, testAncillary).send({ from: rando })
      ),
      "should revert if not called by registered contract"
    );
    assert(
      await didContractThrow(
        sinkOracle.methods.getPrice(testIdentifier, testRequestTime, testAncillary).send({ from: rando })
      ),
      "should revert if not called by registered contract"
    );
    assert.isTrue(
      await sinkOracle.methods.hasPrice(testIdentifier, testRequestTime, testAncillary).send({ from: owner }),
      "should have price after publish"
    );
    assert.equal(
      (
        await sinkOracle.methods.getPrice(testIdentifier, testRequestTime, testAncillary).call({ from: owner })
      ).toString(),
      testPrice,
      "should not revert after publish"
    );
    assert(
      await didContractThrow(
        sinkOracle.methods
          .executePublishPrice(chainID, testIdentifier, testRequestTime, testAncillary, testPrice, { from: rando })
          .send({ from: accounts[0] })
      ),
      "Should not be able to call executePublishPrice again."
    );
  });
  it("formatMetadata", async function () {
    const metadata = await sinkOracle.methods
      .formatMetadata(chainID, testIdentifier, testRequestTime, testAncillary)
      .call();
    const encoded = web3.eth.abi.encodeParameters(
      ["uint8", "bytes32", "uint256", "bytes"],
      [chainID, padRight(testIdentifier, 64), testRequestTime, testAncillary]
    );
    const formattedEncoded = createGenericDepositData(encoded);
    assert.equal(metadata, formattedEncoded);
  });
});
