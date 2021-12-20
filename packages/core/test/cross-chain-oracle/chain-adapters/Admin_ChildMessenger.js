const hre = require("hardhat");
const { web3, assertEventEmitted, getContract } = hre;
const { randomHex, utf8ToHex } = web3.utils;
const { assert } = require("chai");

const { didContractThrow, runDefaultFixture, RegistryRolesEnum, interfaceName } = require("@uma/common");

const Admin_ChildMessenger = getContract("Admin_ChildMessenger");
const OracleSpoke = getContract("OracleSpoke");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Timer = getContract("Timer");

describe("Admin_ChildMessenger", function () {
  let owner, rando, oracleSpoke;
  let messenger;

  before(async () => {
    await runDefaultFixture(hre);
  });

  beforeEach(async () => {
    const accounts = await web3.eth.getAccounts();
    [owner, rando, oracleSpoke] = accounts;

    messenger = await Admin_ChildMessenger.new().send({ from: owner });
    await messenger.methods.setOracleSpoke(oracleSpoke).send({ from: owner });
  });

  it("Setting oracle spoke", async () => {
    // Only owner can set the oracle spoke.
    assert(await didContractThrow(messenger.methods.setOracleSpoke(rando).send({ from: rando })));
    assert(await didContractThrow(messenger.methods.setOracleSpoke(rando).send({ from: oracleSpoke })));

    // Events
    const newOracleSpoke = randomHex(20).toLowerCase();
    const receipt = await messenger.methods.setOracleSpoke(newOracleSpoke).send({ from: owner });

    await assertEventEmitted(
      receipt,
      messenger,
      "SetOracleSpoke",
      (event) => event.newOracleSpoke.toLowerCase() === newOracleSpoke
    );
  });

  it("Send message to parent", async () => {
    const data = utf8ToHex("PRICEREQUESTDATA");

    // Only the oracle spoke can send a message to the parent.
    assert(await didContractThrow(messenger.methods.sendMessageToParent(data).send({ from: rando })));
    assert(await didContractThrow(messenger.methods.sendMessageToParent(data).send({ from: owner })));

    // Events
    const receipt = await messenger.methods.sendMessageToParent(data).send({ from: oracleSpoke });

    await assertEventEmitted(
      receipt,
      messenger,
      "MessageSentToParent",
      (event) => event.oracleSpoke === oracleSpoke && event.data === data
    );
  });

  it("Process message from parent", async () => {
    // Set up commmon infra to run real price requests.
    const finder = await Finder.deployed();
    const registry = await Registry.deployed();
    const timer = await Timer.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
    await registry.methods.registerContract([], owner).send({ from: owner });
    const identifier = utf8ToHex("TESTID");
    const timestamp = await timer.methods.getCurrentTime().call();
    const ancillaryData = utf8ToHex("TESTDATA");

    // Create the spoke oracle and connect it to the messenger.
    const oracleSpokeReal = await OracleSpoke.new(finder.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), messenger.options.address)
      .send({ from: owner });
    await messenger.methods.setOracleSpoke(oracleSpokeReal.options.address).send({ from: owner });

    // Because owner is a registered contract we should be able to send a price request.
    let receipt = await oracleSpokeReal.methods
      .requestPrice(identifier, timestamp, ancillaryData)
      .send({ from: owner });
    await assertEventEmitted(receipt, messenger, "MessageSentToParent");

    // Encode price response data.
    const dataToSend = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes", "int256"],
      [identifier, timestamp, await oracleSpokeReal.methods.stampAncillaryData(ancillaryData).call(), "100"]
    );

    // Only the owner can send a message to the spoke contracts.
    assert(
      await didContractThrow(
        messenger.methods
          .processMessageFromCrossChainParent(dataToSend, oracleSpokeReal.options.address)
          .send({ from: oracleSpoke })
      )
    );
    assert(
      await didContractThrow(
        messenger.methods
          .processMessageFromCrossChainParent(dataToSend, oracleSpokeReal.options.address)
          .send({ from: rando })
      )
    );

    receipt = await messenger.methods
      .processMessageFromCrossChainParent(dataToSend, oracleSpokeReal.options.address)
      .send({ from: owner });

    // Events
    await assertEventEmitted(
      receipt,
      messenger,
      "MessageReceivedFromParent",
      (event) =>
        event.data === dataToSend && event.targetSpoke === oracleSpokeReal.options.address && event.caller === owner
    );

    // Check the price.
    assert.equal(
      await oracleSpokeReal.methods.getPrice(identifier, timestamp, ancillaryData).call({ from: owner }),
      "100"
    );
  });
});
