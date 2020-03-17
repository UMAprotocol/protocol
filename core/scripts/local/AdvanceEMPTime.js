/**
 * This script advances time in the EMP forward by some specified amount of seconds (or one hour by default).
 *
 * `truffle exec ./scripts/local/AdvanceEMPTime --time 10000`
 * Advances time by 10 seconds
 */
const { toBN } = web3.utils;
const argv = require("minimist")(process.argv.slice(), { string: ["time"] });

// Deployed contract ABI's and addresses we need to fetch.
const Governor = artifacts.require("Governor");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Contracts we need to interact with.
let registry;
let emp;

/** ***************************************************
 * Main Script
 /*****************************************************/
const advanceTime = async callback => {
  try {
    registry = await Registry.deployed();
    const contractAddresses = await registry.getAllRegisteredContracts();
    
    // Query all registered EMP's.
    for (const address of contractAddresses) {
      // The governor is always registered as a contract, but it isn't an ExpiringMultiParty.
      if (address !== Governor.address) {
        emp = await ExpiringMultiParty.at(address)

        // Advance time
        let leapForward = (argv.time ? argv.time : 3600 )
        let currentTime = await emp.getCurrentTime()
        let newTime = toBN(currentTime.toString()).add(toBN(leapForward.toString()))
        await emp.setCurrentTime(newTime.toString())
        currentTime = await emp.getCurrentTime()
        let currentTimeReadable = new Date(Number(currentTime.toString())*1000)
        console.log(`Set time to ${currentTimeReadable} for the EMP @ ${emp.address}`);
      }
    }
  } catch (err) {
    console.error(err);
  }
  callback();
};

module.exports = advanceTime;
