const DecodeTransactionData = require("../../scripts/DecodeTransactionData");
const { getRandomSignedInt, getRandomUnsignedInt } = require("@uma/common");

const Registry = artifacts.require("Registry");
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");

contract("scripts/DecodeTransactionData.js", function() {
  let registry;
  before(async function() {
    registry = await Registry.new();
  });
  it("Decode registerContract", async function() {
    const contractAddress = web3.utils.randomHex(20);

    const txnData = registry.contract.methods.registerContract([], contractAddress).encodeABI();

    const expectedObject = {
      name: "registerContract",
      params: {
        parties: [],
        contractAddress: contractAddress
      }
    };

    assert.equal(
      JSON.stringify(DecodeTransactionData.run(txnData)).toLowerCase(),
      JSON.stringify(expectedObject).toLowerCase()
    );
  });

  it("Decode batchReveal", async function() {
    const voting = await VotingInterfaceTesting.at(registry.address);

    // Generate 5 random reveals to test.
    const revealArray = [];
    for (let i = 0; i < 5; i++) {
      revealArray.push({
        identifier: web3.utils.randomHex(32),
        time: getRandomUnsignedInt().toString(),
        price: getRandomSignedInt().toString(),
        salt: getRandomSignedInt().toString()
      });
    }

    const txnData = voting.contract.methods.batchReveal(revealArray).encodeABI();
    const expectedObject = {
      name: "batchReveal",
      params: {
        reveals: revealArray
      }
    };

    assert.equal(
      JSON.stringify(DecodeTransactionData.run(txnData)).toLowerCase(),
      JSON.stringify(expectedObject).toLowerCase()
    );
  });
});
