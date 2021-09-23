/**
 * @notice Creates a new token position with --tokens synthetic tokens backed by --collateral of collateral.
 *
 * Example: `yarn truffle exec ./packages/core/scripts/local/CreateTokens.js --network test --tokens 1000 --collateral 25 --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, toBN } = web3.utils;
const { MAX_UINT_VAL, parseFixed } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const WETH9 = artifacts.require("WETH9");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tokens", "collateral"] });

async function createPosition(callback) {
  try {
    if (!argv.emp || !argv.tokens || !argv.collateral) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --tokens must be the number of synthetic tokens to create.
      required: --collateral must be the amount of collateral to supply to back the tokens.
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const collateralDecimals = (await collateralToken.decimals()).toString();
    const convertCollateral = (numString) => toBN(parseFixed(numString, collateralDecimals).toString());
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const syntheticDecimals = (await syntheticToken.decimals()).toString();
    const convertSynthetic = (numString) => toBN(parseFixed(numString, syntheticDecimals).toString());

    if ((await collateralToken.symbol()) === "WETH") {
      const weth = await WETH9.at(collateralToken.address);
      await weth.deposit({ value: toWei(argv.collateral) });
      console.log(`Wrapped ${argv.collateral} ETH ==> WETH`);
    }

    const account = (await web3.eth.getAccounts())[0];
    const collateral = convertCollateral(argv.collateral);
    const collateralBalance = await collateralToken.balanceOf(account);
    if (collateralBalance.lt(collateral)) {
      throw new Error("Insufficient collateral balance");
    }

    await collateralToken.approve(emp.address, MAX_UINT_VAL);
    await emp.create({ rawValue: collateral.toString() }, { rawValue: convertSynthetic(argv.tokens).toString() });
    console.log(`Created ${argv.tokens} tokens (backed by ${argv.collateral} collateral)`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = createPosition;
