const argv = require("minimist")(process.argv.slice(), { string: ["sponsor"] });

const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const whitelistSponsor = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Grab the whitelist and add the sponsor.
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const sponsorWhitelist = await AddressWhitelist.at(await tokenizedDerivativeCreator.sponsorWhitelist());
    await sponsorWhitelist.addToWhitelist(argv.sponsor);

    console.log("Sponsor Address Whitelisted: " + argv.sponsor);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = whitelistSponsor;
