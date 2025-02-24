const hre = require("hardhat");
const { web3 } = hre;
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const { assert } = require("chai");
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;

const OracleSpoke = getContract("OracleSpoke");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const MessengerMock = getContract("OracleMessengerMock");

const defaultIdentifier = utf8ToHex("Admin 1");
const defaultTimestamp = 100;
const defaultAncillaryData = utf8ToHex("key:value");
const defaultPrice = toWei("1");

describe("OracleSpoke.js", async () => {
  let accounts;
  let owner;
  let rando;

  let oracleSpoke;
  let messenger;
  let finder;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;

    finder = await Finder.new().send({ from: owner });

    const registry = await Registry.new().send({ from: owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
    await registry.methods.registerContract([], owner).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: owner });
  });
  beforeEach(async function () {
    messenger = await MessengerMock.new().send({ from: owner });
    oracleSpoke = await OracleSpoke.new(finder.options.address).send({ from: owner });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), messenger.options.address)
      .send({ from: owner });
  });
  it("constructor", async function () {
    assert.equal(await oracleSpoke.methods.getChildMessenger().call(), messenger.options.address);
  });
  it("requestPrice", async function () {
    const requestPrice = oracleSpoke.methods.requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData);

    // Only registered contract can call
    assert(await didContractThrow(requestPrice.send({ from: rando })));

    const txn1 = await requestPrice.send({ from: owner });
    const parentAncillaryData1 = await oracleSpoke.methods
      .compressAncillaryData(defaultAncillaryData, owner, txn1.blockNumber)
      .call();
    const childRequestId1 = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["address", "bytes32", "uint256", "bytes"],
        [owner, defaultIdentifier, defaultTimestamp, defaultAncillaryData]
      )
    );
    const parentRequestId1 = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [defaultIdentifier, defaultTimestamp, parentAncillaryData1]
      )
    );
    await assertEventEmitted(
      txn1,
      oracleSpoke,
      "PriceRequestBridged",
      (event) =>
        event.requester === owner &&
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === defaultAncillaryData &&
        event.childRequestId === childRequestId1 &&
        event.parentRequestId === parentRequestId1
    );

    // Check that external call messenger.sendMessageToParent occurred.
    assert.equal(await messenger.methods.latestAncillaryData().call(), parentAncillaryData1);
    assert.equal(await messenger.methods.latestTime().call(), defaultTimestamp);
    assert.equal(hexToUtf8(await messenger.methods.latestIdentifier().call()), hexToUtf8(defaultIdentifier));

    // Can call requestPrice again but will not send trigger another external call.
    await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    assert.equal((await messenger.methods.messageCount().call()).toString(), "1");

    // Can call requestPrice without ancillary data:
    const txn2 = await oracleSpoke.methods.requestPrice(defaultIdentifier, defaultTimestamp).send({ from: owner });
    const parentAncillaryData2 = await oracleSpoke.methods.compressAncillaryData("0x", owner, txn2.blockNumber).call();
    const childRequestId2 = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["address", "bytes32", "uint256", "bytes"],
        [owner, defaultIdentifier, defaultTimestamp, utf8ToHex("")]
      )
    );
    const parentRequestId2 = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [defaultIdentifier, defaultTimestamp, parentAncillaryData2]
      )
    );
    await assertEventEmitted(
      txn2,
      oracleSpoke,
      "PriceRequestBridged",
      (event) =>
        event.requester === owner &&
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData === null &&
        event.childRequestId === childRequestId2 &&
        event.parentRequestId === parentRequestId2
    );
    assert.equal(await messenger.methods.latestAncillaryData().call(), parentAncillaryData2);
    assert.equal(await messenger.methods.latestTime().call(), defaultTimestamp);
    assert.equal(hexToUtf8(await messenger.methods.latestIdentifier().call()), hexToUtf8(defaultIdentifier));

    // Can call requestPrice again but will not send trigger another external call.
    await oracleSpoke.methods.requestPrice(defaultIdentifier, defaultTimestamp).send({ from: owner });
    assert.equal((await messenger.methods.messageCount().call()).toString(), "2");
  });
  it("setChildMessenger", async function () {
    // Setting a new messenger happens by changing the address in the finder.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), owner)
      .send({ from: owner });
    assert.equal(await oracleSpoke.methods.getChildMessenger().call(), owner);
  });
  it("processMessageFromParent", async function () {
    // Request price and get expected ancillary data.
    const requestTxn = await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    const expectedAncillaryData = await oracleSpoke.methods
      .compressAncillaryData(defaultAncillaryData, owner, requestTxn.blockNumber)
      .call();
    const expectedData = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes", "int256"],
      [defaultIdentifier, defaultTimestamp, expectedAncillaryData, defaultPrice]
    );

    // Can only call as messenger.
    assert(await didContractThrow(oracleSpoke.methods.processMessageFromParent(expectedData).send({ from: rando })));

    // Call function on mock messenger that will call processMessageFromParent on oracle hub.
    const triggerProcessMessageFromParent = messenger.methods.publishPrice(
      oracleSpoke.options.address,
      defaultIdentifier,
      defaultTimestamp,
      expectedAncillaryData,
      defaultPrice
    );
    await triggerProcessMessageFromParent.send({ from: owner });

    // Should have published a price on oracle spoke
    let pushPriceEvents = await oracleSpoke.getPastEvents("PushedPrice", { fromBlock: 0 });
    assert.equal(pushPriceEvents.length, 1);
    assert.isTrue(
      await oracleSpoke.methods
        .hasPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner })
    );
  });
  it("hasPrice", async function () {
    // Request price and get expected ancillary data.
    const requestTxn1 = await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    const expectedAncillaryData1 = await oracleSpoke.methods
      .compressAncillaryData(defaultAncillaryData, owner, requestTxn1.blockNumber)
      .call();

    assert.isFalse(
      await oracleSpoke.methods
        .hasPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner })
    );

    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData1,
        defaultPrice
      )
      .send({ from: owner });

    // Only registered caller can call
    assert(
      await didContractThrow(
        oracleSpoke.methods.hasPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).call({ from: rando })
      )
    );

    assert.isTrue(
      await oracleSpoke.methods
        .hasPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner })
    );

    // Can call has without ancillary data:
    const requestTxn2 = await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp)
      .send({ from: owner });
    assert.isFalse(await oracleSpoke.methods.hasPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }));
    const expectedAncillaryData2 = await oracleSpoke.methods
      .compressAncillaryData("0x", owner, requestTxn2.blockNumber)
      .call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData2,
        defaultPrice
      )
      .send({ from: owner });
    assert.isTrue(await oracleSpoke.methods.hasPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }));
  });
  it("getPrice", async function () {
    // Request price and get expected ancillary data.
    const requestTxn1 = await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    const expectedAncillaryData1 = await oracleSpoke.methods
      .compressAncillaryData(defaultAncillaryData, owner, requestTxn1.blockNumber)
      .call();

    // Reverts if price not available
    assert(
      await didContractThrow(
        oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).call({ from: owner })
      )
    );

    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData1,
        defaultPrice
      )
      .send({ from: owner });

    // Only registered caller can call
    assert(
      await didContractThrow(
        oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).call({ from: rando })
      )
    );

    assert.equal(
      await oracleSpoke.methods
        .getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner }),
      defaultPrice
    );

    // Can call has without ancillary data:
    const requestTxn2 = await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp)
      .send({ from: owner });
    const expectedAncillaryData2 = await oracleSpoke.methods
      .compressAncillaryData("0x", owner, requestTxn2.blockNumber)
      .call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData2,
        defaultPrice
      )
      .send({ from: owner });
    assert.equal(
      await oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }),
      defaultPrice
    );
  });
  it("compressAncillaryData", async function () {
    // Ancillary data should be compressed to a hash and include block number, spoke, requester and chain id.
    const chainId = await web3.eth.getChainId();
    const childBlockNumber = await web3.eth.getBlockNumber();
    const compressedData = await oracleSpoke.methods
      .compressAncillaryData(defaultAncillaryData, owner, childBlockNumber)
      .call();
    const ancillaryDataHash = web3.utils.sha3(defaultAncillaryData);
    assert.equal(
      hexToUtf8(compressedData),
      `ancillaryDataHash:${ancillaryDataHash.slice(
        2
      )},childBlockNumber:${childBlockNumber},childOracle:${oracleSpoke.options.address
        .slice(2)
        .toLowerCase()},childRequester:${owner.slice(2).toLowerCase()},childChainId:${chainId}`
    );
  });
  it("resolveLegacyRequest", async function () {
    // Reverts as price not yet available
    assert(
      await didContractThrow(
        oracleSpoke.methods
          .resolveLegacyRequest(defaultIdentifier, defaultTimestamp, defaultAncillaryData, owner)
          .send({ from: owner })
      )
    );

    // Only chainId was added to ancillary data for legacy requests, no requester address.
    const chainId = await web3.eth.getChainId();
    const legacyAncillaryData = utf8ToHex(`${hexToUtf8(defaultAncillaryData)},childChainId:${chainId}`);
    const publishPriceTx = await messenger.methods
      .publishPrice(oracleSpoke.options.address, defaultIdentifier, defaultTimestamp, legacyAncillaryData, defaultPrice)
      .send({ from: owner });
    const legacyRequestHash = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [defaultIdentifier, defaultTimestamp, legacyAncillaryData]
      )
    );
    await assertEventEmitted(
      publishPriceTx,
      oracleSpoke,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === legacyAncillaryData.toLowerCase() &&
        event.price.toString() === defaultPrice &&
        event.requestHash === legacyRequestHash
    );

    // Encoding of request was different in the legacy contract so getPrice will revert even though price was pushed.
    assert(
      await didContractThrow(
        oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).call({ from: owner })
      )
    );

    // Requester is now passed when deriving the request hash.
    const requestHash = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ["address", "bytes32", "uint256", "bytes"],
        [owner, defaultIdentifier, defaultTimestamp, defaultAncillaryData]
      )
    );
    let resolveLegactTx = await oracleSpoke.methods
      .resolveLegacyRequest(defaultIdentifier, defaultTimestamp, defaultAncillaryData, owner)
      .send({ from: owner });
    await assertEventEmitted(
      resolveLegactTx,
      oracleSpoke,
      "ResolvedLegacyRequest",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === defaultAncillaryData.toLowerCase() &&
        event.price.toString() === defaultPrice &&
        event.requestHash === requestHash &&
        event.legacyRequestHash === legacyRequestHash
    );

    // getPrice should now return the price as the legacy request was resolved.
    assert.equal(
      await oracleSpoke.methods
        .getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner }),
      defaultPrice
    );

    // Duplicate call does not emit an event.
    resolveLegactTx = await oracleSpoke.methods
      .resolveLegacyRequest(defaultIdentifier, defaultTimestamp, defaultAncillaryData, owner)
      .send({ from: owner });
    await assertEventNotEmitted(resolveLegactTx, oracleSpoke, "ResolvedLegacyRequest");
  });
});
