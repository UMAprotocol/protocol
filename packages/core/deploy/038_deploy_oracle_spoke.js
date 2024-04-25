const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;

  const { deployer } = await getNamedAccounts();

  const finder = await get("Finder");
  console.log(`Using finder @ ${finder.address}`);

  await deploy("OracleSpoke", { from: deployer, args: [finder.address], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = [
  "OracleSpoke",
  "l2-arbitrum-xchain",
  "l2-boba-xchain",
  "l2-optimism-xchain",
  "l2-admin-xchain",
  "l2-base-xchain",
  "l2-blast-xchain",
];
func.dependencies = ["Finder"];
