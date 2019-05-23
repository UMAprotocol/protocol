const Voting = artifacts.require("Voting");
const {
  getKeysForNetwork,
  deployAndGet,
  addToTdr,
  enableControllableTiming
} = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const secondsPerDay = "86400";

  const voting = await deployAndGet(deployer, Voting, secondsPerDay, controllableTiming, { from: keys.deployer });
  await addToTdr(voting, network);
};
