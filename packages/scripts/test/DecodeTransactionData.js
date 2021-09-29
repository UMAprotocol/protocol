const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const DecodeTransactionData = require("../src/DecodeTransactionData");
const { getRandomSignedInt, getRandomUnsignedInt } = require("@uma/common");
const Web3 = require("web3");
const { assert } = require("chai");

const Registry = getContract("Registry");
const Voting = getContract("Voting");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");

describe("scripts/DecodeTransactionData.js", function () {
  before(async function () {
    await runDefaultFixture(hre);
  });
  it("Decode registerContract", async function () {
    const contractAddress = Web3.utils.randomHex(20);

    const registry = await Registry.deployed();
    const txnData = registry.methods.registerContract([], contractAddress).encodeABI();

    const expectedObject = { name: "registerContract", params: { parties: [], contractAddress: contractAddress } };

    assert.equal(
      JSON.stringify(DecodeTransactionData(txnData)).toLowerCase(),
      JSON.stringify(expectedObject).toLowerCase()
    );
  });

  it("Decode batchReveal", async function () {
    const voting = await VotingInterfaceTesting.at((await Voting.deployed()).options.address);

    // Generate 5 random reveals to test.
    const revealArray = [];
    for (let i = 0; i < 5; i++) {
      revealArray.push({
        identifier: Web3.utils.randomHex(32),
        time: getRandomUnsignedInt().toString(),
        price: getRandomSignedInt().toString(),
        salt: getRandomSignedInt().toString(),
      });
    }

    const txnData = voting.methods.batchReveal(revealArray).encodeABI();
    const expectedObject = { name: "batchReveal", params: { reveals: revealArray } };

    assert.equal(
      JSON.stringify(DecodeTransactionData(txnData)).toLowerCase(),
      JSON.stringify(expectedObject).toLowerCase()
    );
  });
});
