/**
 * @notice Reveal a committed vote.
 * @dev Assumes that user passes in the `price`, `identifier`, `time`, and `salt` and reveals using the same
 * account used to send the commit. Arguments are passed in exactly as input into the smart contract methods.
 *
 * Example: $(npm bin)/truffle exec ./scripts/local/RevealVote.js --network test --price 2000000000000000000 --identifier 0x6274632f75736400000000000000000000000000000000000000000000000000 --time 1570000000 --salt 123
 */

const argv = require("minimist")(process.argv.slice(), { string: ["price", "identifier", "time", "salt"] });

const Voting = artifacts.require("Voting");
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");

const { hexToUtf8, fromWei } = web3.utils;

const revealVote = async (callback) => {
  try {
    const price = argv.price;
    const identifier = argv.identifier;
    const time = argv.time;
    const salt = argv.salt;

    if (!price || !identifier || !time || !salt) {
      throw "Specify '--price', '--identifier', '--time' and '--salt' to use this script";
    }

    // Set up voting contract
    const voting = await VotingInterfaceTesting.at((await Voting.deployed()).address);

    // Read account
    const accounts = await web3.eth.getAccounts();
    const votingAccount = accounts[1];
    console.log(`Revealing vote from account: ${votingAccount}`);

    // Format arguments
    const utf8Identifier = hexToUtf8(identifier);
    const priceFromWei = fromWei(price);
    console.group("Reveal parameters: ");
    console.log(`- identifier: ${identifier} (${utf8Identifier})`);
    console.log(`- time: ${time}`);
    console.log(`- price: ${price} (${priceFromWei})`);
    console.log(`- salt: ${salt}`);
    console.groupEnd();

    // Reveal vote:
    const transaction = await voting.revealVote(identifier, time, price, salt, { from: votingAccount });
    console.log(`Successfully revealed vote receipt: ${transaction.tx}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

module.exports = revealVote;
