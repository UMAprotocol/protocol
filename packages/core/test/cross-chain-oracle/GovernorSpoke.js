const hre = require("hardhat");
const { web3 } = hre;
const { getContract, assertEventEmitted } = hre;
const { didContractThrow, interfaceName } = require("@uma/common");
const { assert } = require("chai");
const { utf8ToHex } = web3.utils;

const GovernorSpoke = getContract("GovernorSpoke");
const AddressWhitelist = getContract("AddressWhitelist");
const Finder = getContract("Finder");
const OracleSpoke = getContract("OracleSpoke");

describe("GovernorSpoke.js", async () => {
  let accounts;
  let owner;
  let messenger;

  let governor;
  let addressWhitelist;
  let finder;
  let oracleSpoke;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, messenger] = accounts;
  });

  beforeEach(async function () {
    finder = await Finder.new().send({ from: owner });
    governor = await GovernorSpoke.new(finder.options.address, messenger).send({ from: owner });
    oracleSpoke = await OracleSpoke.new(finder.options.address, messenger).send({ from: owner });
    // Need to set GovernorSpoke so that OracleSpoke.setChildMessenger can be called from GovernorSpoke.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GovernorSpoke), governor.options.address)
      .send({ from: owner });
    // Need to set OracleSpoke so that GovernorSpoke knows who to call to set child messenger.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OracleSpoke), oracleSpoke.options.address)
      .send({ from: owner });

    // Deploy contract that Governor should be able to delegate execution to:
    addressWhitelist = await AddressWhitelist.new().send({ from: owner });
    await addressWhitelist.methods.transferOwnership(governor.options.address).send({ from: owner });
  });
  it("Constructor", async function () {
    const setChildMessengerEvents = await governor.getPastEvents("SetChildMessenger", { fromBlock: 0 });
    assert.equal(setChildMessengerEvents.length, 1);
    assert.equal(setChildMessengerEvents[0].returnValues.childMessenger, messenger);
  });
  it("Can delegate call if called by Messenger", async function () {
    let targetAddress = addressWhitelist.options.address;
    let inputDataBytes = addressWhitelist.methods.addToWhitelist(messenger).encodeABI();
    let messageBytes = web3.eth.abi.encodeParameters(["address", "bytes"], [targetAddress, inputDataBytes]);

    // Only messenger can call.
    assert(await didContractThrow(governor.methods.processMessageFromParent(messageBytes).send({ from: owner })));

    let txn = await governor.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governor,
      "ExecutedGovernanceTransaction",
      (event) => event.to === targetAddress && event.data === inputDataBytes
    );

    assert.isTrue(await addressWhitelist.methods.isOnWhitelist(messenger).call());
  });
  it("Can upgrade the child messenger by calling back into itself", async function () {
    // Craft transaction to set the child messenger to the owner address.
    let targetAddress = governor.options.address;
    let inputDataBytes = governor.methods.setChildMessenger(owner).encodeABI();
    let messageBytes = web3.eth.abi.encodeParameters(["address", "bytes"], [targetAddress, inputDataBytes]);

    let txn = await governor.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governor,
      "ExecutedGovernanceTransaction",
      (event) => event.to === targetAddress && event.data === inputDataBytes
    );

    await assertEventEmitted(txn, governor, "SetChildMessenger", (event) => event.childMessenger === owner);
    assert.equal(await governor.methods.messenger().call(), owner);
    assert.equal(await oracleSpoke.methods.messenger().call(), owner);
  });
});
