const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const GovernorSpoke = getContract("GovernorSpoke");
const AddressWhitelist = getContract("AddressWhitelist");

describe("GovernorSpoke.js", async () => {
  let accounts;
  let owner;
  let messenger;

  let governor;
  let addressWhitelist;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, messenger] = accounts;
  });

  beforeEach(async function () {
    governor = await GovernorSpoke.new(messenger).send({ from: owner });

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
});
