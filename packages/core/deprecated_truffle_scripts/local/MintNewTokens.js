const argv = require("minimist")(process.argv.slice(), { string: ["to", "token", "amount"] });

// Note: this interface also contains a `burn` method, but it isn't used in this script, so it's safe to pass in
// addresses that do not have the `burn` method.
const TestnetERC20 = artifacts.require("TestnetERC20");

const mintNewTokens = async function (callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Initialize the token contract from the address.
    const marginToken = await TestnetERC20.at(argv.token);

    // Mint new tokens.
    await marginToken.allocateTo(argv.to, web3.utils.toWei(argv.amount, "ether"), { from: deployer });

    console.log(`Added ${argv.amount} token(s) at ${marginToken.address} to account ${argv.to}`);
  } catch (e) {
    console.log(`ERROR: ${e}`);
    callback(e);
    return;
  }

  callback();
};

module.exports = mintNewTokens;
