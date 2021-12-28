const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;

  const { deployer } = await getNamedAccounts();

  const finder = await get("Finder");
  console.log(`Using finder @ ${finder.address}`);

  await deploy("OracleSpoke", { from: deployer, args: [finder.address], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["OracleSpoke"];
func.dependencies = ["Finder"];
