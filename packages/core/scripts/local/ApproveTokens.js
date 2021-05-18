const argv = require("minimist")(process.argv.slice(), { string: ["to", "token", "amount"] });

// Note: this interface also contains a `burn` method, but it isn't used in this script, so it's safe to pass in
// addresses that do not have the `burn` method.
const TestnetERC20 = artifacts.require("TestnetERC20");
const { MAX_UINT_VAL } = require("@uma/common");

const approveTokens = async function (callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Initialize the token contract from the address.
    const marginToken = await TestnetERC20.at(argv.token);

    const amount = argv.amount ? web3.utils.toWei(argv.amount) : MAX_UINT_VAL;

    // Mint new tokens.
    await marginToken.approve(argv.to, amount, { from: deployer });

    console.log(`Approved ${amount} token(s) at ${marginToken.address} to be spent by account ${argv.to}`);
  } catch (e) {
    callback(e);
    return;
  }

  callback();
};

module.exports = approveTokens;
