/**
 * @notice Settles all user's tokens assuming an expiry price is available.
 *
 * Example: `yarn truffle exec ./packages/core/scripts/local/SettleTokens.js --network test --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { MAX_UINT_VAL } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp"] });

async function settleTokens(callback) {
  try {
    if (!argv.emp) {
      throw new Error(`
      required: --emp must be the emp address.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());

    const account = (await web3.eth.getAccounts())[0];
    const syntheticBalance = await syntheticToken.balanceOf(account);
    await syntheticToken.approve(emp.address, MAX_UINT_VAL);
    let settlementAmount;
    try {
      settlementAmount = await emp.settleExpired.call();
      console.log(
        `Burning ${syntheticBalance.toString()} tokens to receive ${settlementAmount.toString()} amount of collateral`
      );
    } catch (err) {
      console.error("Settlement will fail, is the contract expired and has an expiry price been received?");
    }

    const receipt = await emp.settleExpired();
    console.log("Receipt: ", receipt.tx);

    const settlementPrice = await emp.expiryPrice();
    console.log(`Expiry price: ${settlementPrice.toString()}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = settleTokens;
