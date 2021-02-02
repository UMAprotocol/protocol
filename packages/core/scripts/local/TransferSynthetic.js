/**
 * @notice Transfers synthetic from accounts[0] with --token of synthetic.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/transferSynthetic.js --network test --token 175 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --to 0x0`
 */
const { toWei, toBN } = web3.utils;
const { getTruffleContract } = require("../../index");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, "1.2.2");
const ExpandedERC20 = getTruffleContract("ExpandedERC20", web3, "1.2.2");

const argv = require("minimist")(process.argv.slice(), { string: ["emp", "token", "to"] });

async function transferSynthetic(callback) {
  try {
    if (!argv.emp || !argv.token || !argv.to) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --token must be the amount of synthetic to send.
      required: --to must be the recipient's address.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const account = (await web3.eth.getAccounts())[0];
    const synthetic = toBN(toWei(argv.token));
    const syntheticBalance = await syntheticToken.balanceOf(account);
    if (syntheticBalance.lt(synthetic)) {
      throw new Error("Insufficient synthetic balance");
    }

    await syntheticToken.transfer(argv.to, synthetic, { from: (await web3.eth.getAccounts())[0] });
    console.log(`Sent ${argv.token} ${await syntheticToken.symbol()} to ${argv.to}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = transferSynthetic;
