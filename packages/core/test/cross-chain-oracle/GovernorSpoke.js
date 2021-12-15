const hre = require("hardhat");
const { getContract, assertEventEmitted, web3 } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const { utf8ToHex } = web3.utils;

const GovernorSpoke = getContract("GovernorSpoke");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");

describe("GovernorSpoke.js", async () => {
  let accounts;
  let owner;
  let messenger;

  let governor;
  let addressWhitelist;
  let identifierWhitelist;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, messenger] = accounts;
  });

  beforeEach(async function () {
    governor = await GovernorSpoke.new(messenger).send({ from: owner });

    // Deploy contract that Governor should be able to delegate execution to:
    addressWhitelist = await AddressWhitelist.new().send({ from: owner });
    await addressWhitelist.methods.transferOwnership(governor.options.address).send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await identifierWhitelist.methods.transferOwnership(governor.options.address).send({ from: owner });
  });
  it("Constructor", async function () {
    const setChildMessengerEvents = await governor.getPastEvents("SetChildMessenger", { fromBlock: 0 });
    assert.equal(setChildMessengerEvents.length, 1);
    assert.equal(setChildMessengerEvents[0].returnValues.childMessenger, messenger);
  });

  it("Can delegate call if called by Messenger", async function () {
    const calls = [
      { to: addressWhitelist.options.address, data: addressWhitelist.methods.addToWhitelist(messenger).encodeABI() },
      {
        to: identifierWhitelist.options.address,
        data: identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex("Messenger")).encodeABI(),
      },
    ];

    let messageBytes = web3.eth.abi.encodeParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "to", type: "address" },
            { name: "data", type: "bytes" },
          ],
        },
      ],
      [calls]
    );

    // Only messenger can call.
    assert(await didContractThrow(governor.methods.processMessageFromParent(messageBytes).send({ from: owner })));

    let txn = await governor.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governor,
      "ExecutedGovernanceTransaction",
      (event) => event.data === calls[0].data && event.to === calls[0].to
    );
    await assertEventEmitted(
      txn,
      governor,
      "ExecutedGovernanceTransaction",
      (event) => event.data === calls[1].data && event.to === calls[1].to
    );

    assert.isTrue(await addressWhitelist.methods.isOnWhitelist(messenger).call());
    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(utf8ToHex("Messenger")).call());
  });
});
