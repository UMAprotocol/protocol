const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  // const Finder = await deployments.get("Finder");

  await deploy("DesignatedVotingV2Factory", {
    from: deployer,
    args: ["0x40f941E48A552bF496B154Af6bf55725f18D77c3"],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["DesignatedVotingV2Factory", "dvm"];
// func.dependencies = ["Finder"];
