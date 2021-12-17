const hre = require("hardhat");
const { getContract, assertEventEmitted, web3 } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const { toChecksumAddress } = web3.utils;

const GovernorHub = getContract("GovernorHub");
const MessengerMock = getContract("GovernorMessengerMock");

describe("GovernorHub.js", async () => {
  let accounts;
  let owner;
  let rando;

  let governor;
  let messenger;

  const areCallsEqual = (a, b) =>
    a.every(
      (aCall, index) => toChecksumAddress(aCall.to) === toChecksumAddress(b[index].to) && aCall.data === b[index].data
    );

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
  });

  beforeEach(async function () {
    governor = await GovernorHub.new().send({ from: owner });
    messenger = await MessengerMock.new().send({ from: owner });
  });

  it("setMessenger", async function () {
    // Only owner can call
    assert(await didContractThrow(governor.methods.setMessenger("1", messenger.options.address).send({ from: rando })));

    const tx = await governor.methods.setMessenger(1, messenger.options.address).send({ from: owner });
    await assertEventEmitted(
      tx,
      governor,
      "SetParentMessenger",
      (event) => event.chainId.toString() === "1" && event.parentMessenger === messenger.options.address
    );
  });
  it("relayGovernance", async function () {
    await governor.methods.setMessenger(1, messenger.options.address).send({ from: owner });

    const calls = [
      { to: web3.utils.randomHex(20), data: "0xdeadbeef" },
      { to: web3.utils.randomHex(20), data: "0xdeadbeefbeef" },
    ];
    const relayGovernance = governor.methods.relayGovernance("1", calls);

    // Only owner can call
    assert(await didContractThrow(relayGovernance.send({ from: rando })));

    const tx = await relayGovernance.send({ from: owner });
    const dataSentToChild = web3.eth.abi.encodeParameters(
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
    await assertEventEmitted(
      tx,
      governor,
      "RelayedGovernanceRequest",
      (event) =>
        event.chainId.toString() === "1" &&
        event.messenger === messenger.options.address &&
        areCallsEqual(event.calls, calls) &&
        event.dataSentToChild === dataSentToChild
    );

    // Check that external call messenger.sendMessageToChild occurred.
    assert.isTrue(areCallsEqual(await messenger.methods.latestCalls().call(), calls));
  });
});
