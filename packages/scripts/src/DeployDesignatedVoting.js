const argv = require("minimist")(process.argv.slice(), { string: ["ownershipAddress"] });

const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");

async function run(deployedFactory, ownershipAddress) {
  const account = (await web3.eth.getAccounts())[0];
  // TODO(ptare): Handle the case where a DesignatedVoting is already deployed for this voting address `account`.
  await deployedFactory.newDesignatedVoting(ownershipAddress, { from: account });
  const designatedVotingAddress = await deployedFactory.designatedVotingContracts(account);
  console.log("VOTING ADDRESS:", account);
  console.log("DESIGNATED VOTING ADDRESS:", designatedVotingAddress);
}

const deployDesignatedVoting = async function (callback) {
  if (!argv.ownershipAddress) {
    callback("Must include <ownershipAddress>");
  }
  try {
    const factory = await DesignatedVotingFactory.deployed();
    await run(factory, argv.ownershipAddress);
  } catch (e) {
    console.log("ERROR:", e);
    callback(e);
  }
  callback();
};

deployDesignatedVoting.run = run;
module.exports = deployDesignatedVoting;
