const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const votingToken = await deploy("VotingToken", { from: deployer, log: true, skipIfAlreadyDeployed: true });

  // Add the newly deployed voting token to the finder. this is needed in some other contracts deployment process.
  const finderContract = await deployments.get("Finder");
  const finder = new web3.eth.Contract(finderContract.abi, finderContract.address);
  await finder.methods
    .changeImplementationAddress(
      hre.web3.utils.padRight(hre.web3.utils.utf8ToHex("VotingToken"), 64),
      votingToken.address
    )
    .send({ from: deployer });
};
module.exports = func;
func.tags = ["dvm", "VotingToken"];
