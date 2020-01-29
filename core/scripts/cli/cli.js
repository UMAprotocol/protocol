const Finder = artifacts.require("Finder");

const cli = async function(callback) {
  try {
    const deployedFinder = await Finder.deployed();

    console.log(deployedFinder.address);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = cli;