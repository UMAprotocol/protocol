/**
 * This script advances time in all EMP's and the Voting contract forward by some specified amount of seconds (or one hour and one second by default).
 *
 * `truffle exec ./scripts/local/AdvanceEMPTime --time 10`
 * Advances time for all contracts by 10 seconds
 */
const { toBN } = web3.utils;
const argv = require("minimist")(process.argv.slice(), { string: ["time"] });
const { interfaceName } = require("../../utils/Constants.js");

// Deployed contract ABI's and addresses we need to fetch.
const Governor = artifacts.require("Governor");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");

const advanceTime = async callback => {
  try {
    let registry = await Registry.deployed();
    const contractAddresses = await registry.getAllRegisteredContracts();

    let leapForward = argv.time ? argv.time : 3601;
    console.log(`Advancing contract time forward by ${leapForward} seconds`);

    // Query all registered EMP's.
    for (const address of contractAddresses) {
      // The governor is always registered as a contract, but it isn't an ExpiringMultiParty.
      if (address !== Governor.address) {
        let emp = await ExpiringMultiParty.at(address);

        // Advance time in the EMP.
        let currentTime = await emp.getCurrentTime();
        let newTime = toBN(currentTime).add(toBN(leapForward));
        await emp.setCurrentTime(newTime);
        currentTime = await emp.getCurrentTime();
        let currentTimeReadable = new Date(Number(currentTime) * 1000);
        console.log(`Set time to ${currentTimeReadable} for the EMP @ ${emp.address}`);
      }
    }

    // Advance time in the registered Oracle.
    const finder = await Finder.deployed();
    const deployedVoting = await Voting.at(
      await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    );
    let currentTime = await deployedVoting.getCurrentTime();
    let newTime = toBN(currentTime).add(toBN(leapForward));
    await deployedVoting.setCurrentTime(newTime);
    currentTime = await deployedVoting.getCurrentTime();
    let currentTimeReadable = new Date(Number(currentTime) * 1000);
    console.log(`Set time to ${currentTimeReadable} for the DVM @ ${deployedVoting.address}`);
  } catch (err) {
    callback(err);
  }
  callback();
};

module.exports = advanceTime;
