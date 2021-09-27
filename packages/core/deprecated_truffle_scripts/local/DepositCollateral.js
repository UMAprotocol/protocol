/**
 * @notice Deposits collateral into existing token position with --collateral of collateral.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/DepositCollateral.js --network test --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "collateral"] });

async function depositCollateral(callback) {
  try {
    if (!argv.emp || !argv.collateral) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --collateral must be the amount of collateral to supply to back the tokens.
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

    await collateralToken.approve(emp.address, MAX_UINT_VAL);
    await emp.deposit({ rawValue: collateral.toString() });
    console.log(`Deposited ${argv.collateral} of ${await collateralToken.symbol()}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = depositCollateral;
