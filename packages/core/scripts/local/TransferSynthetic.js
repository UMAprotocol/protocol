/**
 * @notice Transfers synthetic from accounts[0] with --token of synthetic.
 *
 * Example: `yarn truffle exec ./scripts/local/transferSynthetic.js --network test --token 175 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --to 0x0 --cversion latest`
 */
const { toWei, toBN } = web3.utils;
const { getTruffleContract } = require("../../dist/index");

const argv = require("minimist")(process.argv.slice(), { string: ["emp", "synthetic", "to", "cversion"] });
const abiVersion = argv.cversion || "1.2.2"; // Default to most recent mainnet deployment, 1.2.2.

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, abiVersion);
const ExpandedERC20 = getTruffleContract("ExpandedERC20", web3, "1.2.2");

async function transferSynthetic(callback) {
  try {
    if (!argv.emp || !argv.to) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --to must be the recipient's address.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const account = (await web3.eth.getAccounts())[0];
    const syntheticBalance = await syntheticToken.balanceOf(account);
    const syntheticAmount = argv.synthetic ? toBN(toWei(argv.synthetic)) : syntheticBalance;
    if (syntheticBalance.lt(syntheticAmount)) {
      throw new Error("Insufficient synthetic balance");
    }

    await syntheticToken.transfer(argv.to, syntheticAmount, { from: (await web3.eth.getAccounts())[0] });
    console.log(`Sent ${syntheticAmount} ${await syntheticToken.symbol()} to ${argv.to}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = transferSynthetic;
