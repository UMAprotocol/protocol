/**
 * @notice Creates a new token position with --tokens synthetic tokens backed by --collateral of collateral.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/LiquidateEMP.js --network test --tokens 1000 --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("../../../common/Constants");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const TestnetERC20 = artifacts.require("TestnetERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tokens", "collateral"] });

async function createPosition(callback) {
  try {
    if (!argv.emp || !argv.tokens || !argv.collateral) {
      throw `
      required: --emp must be the emp address.
      required: --tokens must be the number of synthetic tokens to create.
      required: --collateral must be the amount of collateral to supply to back the tokens.
      `;
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    // Create tokens for liquidator to liquidate with.
    collateralToken = await TestnetERC20.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const collateral = toBN(toWei(argv.collateral));
    const collateralBalance = await collateralToken.balanceOf(account);
    if (collateralBalance.lt(collateral)) {
      await collateralToken.allocateTo(account, collateral.sub(collateralBalance).toString());
    }

    await collateralToken.approve(emp.address, MAX_UINT_VAL);
    await emp.create({ rawValue: collateral.toString() }, { rawValue: toWei(argv.tokens) });
    console.log(`Created ${argv.tokens} tokens (backed by ${argv.collateral} collateral)`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = createPosition;
