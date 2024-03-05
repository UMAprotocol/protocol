const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const GovernorV2 = await deployments.get("GovernorV2");
  const VotingToken = await deployments.get("VotingToken");

  const defaultBond = web3.utils.toWei("5000");

  await deploy("ProposerV2", {
    from: deployer,
    args: [VotingToken.address, defaultBond, GovernorV2.address, Finder.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["ProposerV2", "dvmv2"];
func.dependencies = ["Finder", "VotingToken", "GovernorV2"];
