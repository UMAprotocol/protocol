const argv = require("minimist")(process.argv.slice(), { string: ["token"] });

const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const whitelistToken = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Grab the whitelist and add the token to it.
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );
    await marginCurrencyWhitelist.addToWhitelist(argv.token);

    console.log("Token Address Whitelisted: " + argv.token);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = whitelistToken;
