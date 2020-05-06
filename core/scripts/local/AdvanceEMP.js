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
const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");

const advanceTime = async callback => {
  try {
    const leapForward = argv.time ? argv.time : 7200;
    console.log(`Advancing contract time forward by ${leapForward} seconds`);

    // Since MockOracle and EMP share the same Timer, it suffices to just advance the oracle's time.
    const finder = await Finder.deployed();
    const deployedVoting = await Voting.at(
      await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    );
    let currentTime = await deployedVoting.getCurrentTime();
    const newTime = toBN(currentTime).add(toBN(leapForward));
    await deployedVoting.setCurrentTime(newTime);
    currentTime = await deployedVoting.getCurrentTime();
    const currentTimeReadable = new Date(Number(currentTime) * 1000);
    console.log(`Set time to ${currentTimeReadable} for the DVM @ ${deployedVoting.address}`);
  } catch (err) {
    callback(err);
  }
  callback();
};

module.exports = advanceTime;
