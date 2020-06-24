/**
 * @notice Transfers collateral from accounts[0] with --collateral of collateral.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/transferCollateral.js --network test --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --to 0x0`
 */
const { toWei, toBN } = web3.utils;

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "collateral", "to"] });

async function transferCollateral(callback) {
  try {
    if (!argv.emp || !argv.collateral || !argv.to) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --collateral must be the amount of collateral to send.
      required: --to must be the recipient's address.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const account = (await web3.eth.getAccounts())[0];
    const collateral = toBN(toWei(argv.collateral));
    const collateralBalance = await collateralToken.balanceOf(account);
    if (collateralBalance.lt(collateral)) {
      throw new Error("Insufficient collateral balance");
    }

    await collateralToken.transfer(argv.to, collateral);
    console.log(`Sent ${argv.collateral} ${await collateralToken.symbol()} to ${argv.to}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = transferCollateral;
