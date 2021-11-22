const hre = require("hardhat");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { didContractThrow, ZERO_ADDRESS, interfaceName } = require("@uma/common");
const { assert } = require("chai");
const { toWei, utf8ToHex, hexToUtf8, soliditySha3 } = web3.utils;

const OracleHub = getContract("OracleHub");
const Finder = getContract("Finder");
const MockOracle = getContract("MockOracleAncillary");
const ERC20 = getContract("ExpandedERC20");
const MessengerMock = getContract("OracleMessengerMock");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Store = getContract("Store");

const defaultIdentifier = utf8ToHex("Admin 1");
const defaultTimestamp = 100;
const defaultAncillaryData = "0xdeadbeef";
const defaultPrice = toWei("1");
const defaultFinalFee = toWei("1");

describe("OracleHub.js", async () => {
  let accounts;
  let owner;
  let rando;

  let oracleHub;
  let messenger;
  let finder;
  let collateral;
  let oracle;
  let store;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;

    finder = await Finder.new().send({ from: owner });

    const identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
  });

  beforeEach(async function () {
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, ZERO_ADDRESS).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });

    collateral = await ERC20.new("UMA", "UMA", 18).send({ from: owner });
    await collateral.methods.addMember(1, owner).send({ from: owner });
    await collateral.methods.mint(owner, toWei("100")).send({ from: owner });
    await store.methods.setFinalFee(collateral.options.address, { rawValue: defaultFinalFee }).send({ from: owner });

    oracle = await MockOracle.new(finder.options.address, ZERO_ADDRESS).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), oracle.options.address)
      .send({ from: owner });

    oracleHub = await OracleHub.new(finder.options.address, collateral.options.address).send({ from: owner });
    messenger = await MessengerMock.new().send({ from: owner });
  });
  it("setMessenger", async function () {
    // Only owner can call
    assert(
      await didContractThrow(oracleHub.methods.setMessenger("1", messenger.options.address).send({ from: rando }))
    );

    const tx = await oracleHub.methods.setMessenger(1, messenger.options.address).send({ from: owner });
    await assertEventEmitted(
      tx,
      oracleHub,
      "SetParentMessenger",
      (event) => event.chainId.toString() === "1" && event.parentMessenger === messenger.options.address
    );
  });
  it("publishPrice", async function () {
    await oracleHub.methods.setMessenger(1, messenger.options.address).send({ from: owner });

    const publishPrice = oracleHub.methods.publishPrice("1", defaultIdentifier, defaultTimestamp, defaultAncillaryData);

    // Reverts if price is not resolved on oracle.
    assert(await didContractThrow(publishPrice.send({ from: rando })));

    // Resolve price on oracle and publish to oracle hub.
    await oracle.methods.requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).send({ from: owner });
    await oracle.methods
      .pushPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData, defaultPrice)
      .send({ from: owner });
    await publishPrice.send({ from: owner });

    // Check that external call messenger.sendMessageToChild occurred.
    assert.equal(await messenger.methods.latestAncillaryData().call(), defaultAncillaryData);
    assert.equal(await messenger.methods.latestTime().call(), defaultTimestamp);
    assert.equal(hexToUtf8(await messenger.methods.latestIdentifier().call()), hexToUtf8(defaultIdentifier));
    assert.equal(await messenger.methods.latestPrice().call(), defaultPrice);
  });
  it("processMessageFromChild", async function () {
    const expectedData = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [defaultIdentifier, defaultTimestamp, defaultAncillaryData]
    );

    // Can only call as messenger.
    await oracleHub.methods.setMessenger(1, messenger.options.address).send({ from: owner });
    assert(await didContractThrow(oracleHub.methods.processMessageFromChild("1", expectedData).send({ from: owner })));

    // Call function on mock messenger that will call processMessageFromChild on oracle hub.
    const triggerProcessMessageFromChild = messenger.methods.requestPrice(
      oracleHub.options.address,
      "1",
      defaultIdentifier,
      defaultTimestamp,
      defaultAncillaryData
    );
    await triggerProcessMessageFromChild.send({ from: owner });

    // Should have triggered a price on the mock oracle.
    let requestPriceEvents = await oracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
    assert.equal(requestPriceEvents.length, 1);

    // Calling it again will not re-request the price and will not revert.
    await triggerProcessMessageFromChild.send({ from: owner });
    requestPriceEvents = await oracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
    assert.equal(requestPriceEvents.length, 1);
  });
  it("requestPrice", async function () {
    await oracleHub.methods.setMessenger(1, messenger.options.address).send({ from: owner });
    const requestPrice = oracleHub.methods.requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData);

    // Fails if caller hasn't approved contract to pull final fee
    assert(await didContractThrow(requestPrice.send({ from: owner })));

    await collateral.methods.approve(oracleHub.options.address, defaultFinalFee).send({ from: owner });
    const txn1 = await requestPrice.send({ from: owner });
    assert.equal((await collateral.methods.balanceOf(store.options.address).call()).toString(), defaultFinalFee);

    // Check that internal _requestPrice call executed.
    await assertEventEmitted(
      txn1,
      oracleHub,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === defaultAncillaryData.toLowerCase()
    );

    // Calling it again succeeds but does not emit event. It also doesn't need to pull final fee from caller.
    const txn2 = await oracleHub.methods
      .requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    await assertEventNotEmitted(txn2, oracleHub, "PriceRequestAdded");

    // Publishing price will now emit an event because price was requested.
    await oracle.methods.requestPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData).send({ from: owner });
    await oracle.methods
      .pushPrice(defaultIdentifier, defaultTimestamp, defaultAncillaryData, defaultPrice)
      .send({ from: owner });
    const txn3 = await oracleHub.methods
      .publishPrice("1", defaultIdentifier, defaultTimestamp, defaultAncillaryData)
      .send({ from: owner });
    const requestHash = soliditySha3(
      web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [defaultIdentifier, defaultTimestamp, defaultAncillaryData]
      )
    );
    await assertEventEmitted(
      txn3,
      oracleHub,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(defaultIdentifier) &&
        event.time.toString() === defaultTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === defaultAncillaryData.toLowerCase() &&
        event.price.toString() === defaultPrice &&
        event.requestHash === requestHash
    );
  });
});
