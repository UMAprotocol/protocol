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

  let governorSpoke;
  let addressWhitelist;
  let finder;
  let oracleSpoke;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, messenger] = accounts;
  });

  beforeEach(async function () {
    finder = await Finder.new().send({ from: owner });
    governorSpoke = await GovernorSpoke.new(finder.options.address).send({ from: owner });
    oracleSpoke = await OracleSpoke.new(finder.options.address).send({ from: owner });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), messenger)
      .send({ from: owner });

    await finder.methods.transferOwnership(governorSpoke.options.address).send({ from: owner });

    // Deploy contract that GovernorSpoke should be able to delegate execution to:
    addressWhitelist = await AddressWhitelist.new().send({ from: owner });
    await addressWhitelist.methods.transferOwnership(governorSpoke.options.address).send({ from: owner });
  });

  it("Can delegate call if called by Messenger", async function () {
    let targetAddress = addressWhitelist.options.address;
    let inputDataBytes = addressWhitelist.methods.addToWhitelist(messenger).encodeABI();
    let messageBytes = web3.eth.abi.encodeParameters(["address", "bytes"], [targetAddress, inputDataBytes]);

    // Only messenger can call.
    assert(await didContractThrow(governorSpoke.methods.processMessageFromParent(messageBytes).send({ from: owner })));

    let txn = await governorSpoke.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governorSpoke,
      "ExecutedGovernanceTransaction",
      (event) => event.to === targetAddress && event.data === inputDataBytes
    );

    assert.isTrue(await addressWhitelist.methods.isOnWhitelist(messenger).call());
  });
  it("Can upgrade the child messenger by calling into the finder", async function () {
    // Craft transaction to set the child messenger to the owner address.
    let targetAddress = finder.options.address;
    let inputDataBytes = finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), owner)
      .encodeABI();
    let messageBytes = web3.eth.abi.encodeParameters(["address", "bytes"], [targetAddress, inputDataBytes]);

    let txn = await governorSpoke.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governorSpoke,
      "ExecutedGovernanceTransaction",
      (event) => event.to === targetAddress && event.data === inputDataBytes
    );

    assert.equal(await governorSpoke.methods.getChildMessenger().call(), owner);
    assert.equal(await oracleSpoke.methods.getChildMessenger().call(), owner);
  });
});
