const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });

const CentralizedOracle = artifacts.require("CentralizedOracle");

const remarginDerivative = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Remargin the contract using the oracle.
    const centralizedOracle = await CentralizedOracle.deployed();
    await centralizedOracle.callRemargin(argv.derivative);

    console.log("Derivative Remargined: " + argv.derivative);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = remarginDerivative;
