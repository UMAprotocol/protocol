/**
 * @notice Redeems --tokens of synthetic for proportional amount of collateral.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/RedeemCollateral.js --network test --tokens 1 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tokens"] });

async function redeemTokens(callback) {
  try {
    if (!argv.emp || !argv.tokens) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --tokens must be the amount of tokens to burn.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const account = (await web3.eth.getAccounts())[0];
    const tokens = toBN(toWei(argv.tokens));
    const tokenBalance = await syntheticToken.balanceOf(account);
    if (tokenBalance.lt(tokens)) {
      throw new Error("Insufficient synthetic balance");
    }

    await syntheticToken.approve(emp.address, MAX_UINT_VAL);
    await emp.redeem({ rawValue: tokens.toString() });
    console.log(`Redeemed ${argv.tokens} of ${await syntheticToken.symbol()}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = redeemTokens;
