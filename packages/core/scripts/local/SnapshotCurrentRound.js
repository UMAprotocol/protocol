const Voting = artifacts.require("Voting");
const { signMessage } = require("@uma/common");

const snapshotRound = async (callback) => {
  try {
    const voting = await Voting.deployed();
    const accounts = await web3.eth.getAccounts();
    const snapshotMessage = "Sign For Snapshot";
    const signature = await signMessage(web3, snapshotMessage, accounts[0]);

    const transaction = await voting.snapshotCurrentRound(signature, { from: accounts[0] });
    console.log("Snapshotted current round:", transaction.receipt.rawLogs);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

module.exports = snapshotRound;
