/**
 * @notice Withdraws --collateral of collateral instantly or throws a GCR warning.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/WithdrawCollateral.js --network test --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, toBN } = web3.utils;

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "collateral"] });

async function withdrawCollateral(callback) {
  try {
    if (!argv.emp || !argv.collateral) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --collateral must be the amount of collateral to withdraw.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const collateral = toBN(toWei(argv.collateral));

    try {
      await emp.withdraw({ rawValue: collateral.toString() });
      console.log(`Withdrew ${argv.collateral} of ${await collateralToken.symbol()}`);
    } catch (err) {
      // Withdraw failed, possibly due to a GCR error.
      console.error("Invalid withdrawal attempt:", err);

      // TODO: Request a withdrawal instead?
    }
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = withdrawCollateral;
