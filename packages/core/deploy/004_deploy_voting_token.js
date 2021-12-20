const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("VotingToken", { from: deployer, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["dvm"];
