const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");
const VotingTest = artifacts.require("VotingTest");

const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../../common/Enums.js");
const { interfaceName } = require("../../utils/Constants.js");

const truffleAssert = require("truffle-assertions");

async function runExport() {
  console.log("Running DVM upgrade script🔥");
  console.log("Connected to network id", await web3.eth.net.getId());
  const accounts = await web3.eth.getAccounts();

  /** ***********************
   * 1) upgrade Voting.sol *
   *************************/

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Get the previously deployed VotingToken and Finder.
  console.log("VotingToken.address", VotingToken.address);
  console.log("Finder.address", Finder.address);

  const votingToken = new web3.eth.Contract(VotingToken.abi, VotingToken.address);
  const finder = new web3.eth.Contract(Finder.abi, Finder.address);

  // Set phase length to one day.
  const secondsPerDay = "86400";

  const voting = await Voting.new(
    secondsPerDay,
    gatPercentage,
    inflationRate,
    rewardsExpirationTimeout,
    VotingToken.address,
    Finder.address,
    "0x0000000000000000000000000000000000000000",
    { from: accounts[0] }
  );

  console.log("voting upgraded @", voting.address);

  const upgradeTx = finder.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), voting.address)
    .encodeABI();

  console.log("upgradeTx", upgradeTx);

  /** *************************
   * 1) upgrade Registry.sol *
   ***************************/

  //   const registry = await Registry.new({ from: accounts[0] });
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
