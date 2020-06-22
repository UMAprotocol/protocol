/**
 * @notice Deposits collateral into existing token position with --collateral of collateral.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/DepositCollateral.js --network test --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --collateralToken 0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99`
 */
const { toWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("../../../common/Constants");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const TestnetERC20 = artifacts.require("TestnetERC20");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "collateral", "collateralToken"] });

async function createPosition(callback) {
  try {
    if (!argv.emp || !argv.collateral) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --collateral must be the amount of collateral to supply to back the tokens.
      optional: --collateralToken must be the address of the deployed collateral currency
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    collateralToken = argv.collateralToken
      ? await ExpandedERC20.at(argv.collateralToken)
      : await TestnetERC20.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const collateral = toBN(toWei(argv.collateral));
    const collateralBalance = await collateralToken.balanceOf(account);
    if (collateralBalance.lt(collateral)) {
      if (argv.collateralToken) {
        throw new Error("Insufficient collateral balance");
      } else {
        await collateralToken.allocateTo(account, collateral.sub(collateralBalance).toString());
      }
    }

    await collateralToken.approve(emp.address, MAX_UINT_VAL);
    await emp.deposit({ rawValue: collateral.toString() });
    console.log(`Deposited ${argv.collateral} collateral`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = createPosition;
