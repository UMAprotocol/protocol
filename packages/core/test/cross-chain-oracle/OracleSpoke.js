const hre = require("hardhat");
const { web3 } = hre;
const { getContract, assertEventEmitted } = hre;
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
    await assertEventEmitted(txn1, oracleSpoke, "PriceRequestAdded");

    // Check that external call messenger.sendMessageToParent occurred.
    let expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData(defaultAncillaryData).call();
    assert.equal(await messenger.methods.latestAncillaryData().call(), expectedAncillaryData);
    assert.equal(await messenger.methods.latestTime().call(), defaultTimestamp);
    assert.equal(hexToUtf8(await messenger.methods.latestIdentifier().call()), hexToUtf8(defaultIdentifier));

    // Can call requestPrice again but will not send trigger another external call.
    await oracleSpoke.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    assert.equal((await messenger.methods.messageCount().call()).toString(), "1");

    // Can call requestPrice without ancillary data:
    const txn2 = await oracleSpoke.methods.requestPrice(defaultIdentifier, defaultTimestamp).send({ from: owner });
    await assertEventEmitted(txn2, oracleSpoke, "PriceRequestAdded");
    expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData("0x").call();
    assert.equal(await messenger.methods.latestAncillaryData().call(), expectedAncillaryData);
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
    const expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData(defaultAncillaryData).call();
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
    assert.isFalse(
      await oracleSpoke.methods
        .hasPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
        .call({ from: owner })
    );

    let expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData(defaultAncillaryData).call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData,
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
    assert.isFalse(await oracleSpoke.methods.hasPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }));
    expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData("0x").call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData,
        defaultPrice
      )
      .send({ from: owner });
    assert.isTrue(await oracleSpoke.methods.hasPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }));
  });
  it("getPrice", async function () {
    // Reverts if price not available
    assert(
      await didContractThrow(
        oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).call({ from: owner })
      )
    );

    let expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData(defaultAncillaryData).call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData,
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
    expectedAncillaryData = await oracleSpoke.methods.stampAncillaryData("0x").call();
    await messenger.methods
      .publishPrice(
        oracleSpoke.options.address,
        defaultIdentifier,
        defaultTimestamp,
        expectedAncillaryData,
        defaultPrice
      )
      .send({ from: owner });
    assert.equal(
      await oracleSpoke.methods.getPrice(defaultIdentifier, defaultTimestamp).call({ from: owner }),
      defaultPrice
    );
  });
  it("stampAncillaryData", async function () {
    const stampedAncillaryData = await oracleSpoke.methods.stampAncillaryData(defaultAncillaryData).call();
    const chainId = await web3.eth.getChainId();
    assert.equal(hexToUtf8(stampedAncillaryData), `${hexToUtf8(defaultAncillaryData)},childChainId:${chainId}`);
  });
});
