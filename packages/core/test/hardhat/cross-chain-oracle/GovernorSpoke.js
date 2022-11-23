const hre = require("hardhat");
const { getContract, assertEventEmitted, web3 } = hre;
const { didContractThrow, interfaceName } = require("@uma/common");
const { assert } = require("chai");
const { utf8ToHex } = web3.utils;

const GovernorSpoke = getContract("GovernorSpoke");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const OracleSpoke = getContract("OracleSpoke");

describe("GovernorSpoke.js", async () => {
  let accounts;
  let owner;
  let messenger;

  let governorSpoke;
  let addressWhitelist;
  let identifierWhitelist;
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

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await identifierWhitelist.methods.transferOwnership(governorSpoke.options.address).send({ from: owner });
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
    assert(await didContractThrow(governorSpoke.methods.processMessageFromParent(messageBytes).send({ from: owner })));

    let txn = await governorSpoke.methods.processMessageFromParent(messageBytes).send({ from: messenger });
    await assertEventEmitted(
      txn,
      governorSpoke,
      "ExecutedGovernanceTransaction",
      (event) => event.data === calls[0].data && event.to === calls[0].to
    );
    await assertEventEmitted(
      txn,
      governorSpoke,
      "ExecutedGovernanceTransaction",
      (event) => event.data === calls[1].data && event.to === calls[1].to
    );

    assert.isTrue(await addressWhitelist.methods.isOnWhitelist(messenger).call());
    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(utf8ToHex("Messenger")).call());
  });
  it("Can upgrade the child messenger by calling into the finder", async function () {
    // Craft transaction to set the child messenger to the owner address.
    let targetAddress = finder.options.address;
    let inputDataBytes = finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), owner)
      .encodeABI();
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
      [[{ to: targetAddress, data: inputDataBytes }]]
    );

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
