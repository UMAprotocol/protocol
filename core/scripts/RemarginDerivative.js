const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });
const { interfaceName } = require("../utils/Constants.js");

const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");

const remarginDerivative = async function(callback) {
  try {
    const deployedFinder = await Finder.deployed();

    // Remargin the contract using the admin.
    const admin = await FinancialContractsAdmin.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin))
    );
    await admin.callRemargin(argv.derivative);

    console.log("Derivative Remargined: " + argv.derivative);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = remarginDerivative;
