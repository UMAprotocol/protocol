/**
 * @notice Wrap or unwrap --collateral amount of WETH. Unwrap by passing in `--unwrap` flag.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/ConvertWeth.js --network test --collateral 25 --emp 0x0`
 */
const { toWei, fromWei } = web3.utils;

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const WETH9 = artifacts.require("WETH9");
const argv = require("minimist")(process.argv.slice(), { string: ["collateral", "emp"], boolean: ["unwrap"] });

async function convertWeth(callback) {
  try {
    if (!argv.emp || !argv.collateral) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --collateral must be the of WETH to wrap or unwrap
      `);
    }

    const emp = await ExpiringMultiParty.at(argv.emp);
    const weth = await WETH9.at(await emp.collateralCurrency());

    if (!argv.unwrap) {
      await weth.deposit({ value: toWei(argv.collateral) });
      console.log(`Wrapped ${argv.collateral} ETH ==> WETH`);
    } else {
      console.log("TODO: Implement unwrapping.");
    }

    const caller = (await web3.eth.getAccounts())[0];
    const newBalance = await weth.balanceOf(caller);
    console.log(`New WETH balance: ${fromWei(newBalance.toString())}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = convertWeth;
