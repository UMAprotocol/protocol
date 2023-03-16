const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // baseSlashAmount: amount slashed for missing a vote or voting wrong.
  const baseSlashAmount = web3.utils.toWei("0.0016", "ether");

  // governanceSlashAmount: amount slashed for voting wrong in a governance vote.
  const governanceSlashAmount = web3.utils.toWei("0", "ether");

  await deploy("FixedSlashSlashingLibrary", {
    from: deployer,
    args: [baseSlashAmount, governanceSlashAmount],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["FixedSlashSlashingLibrary"];
func.dependencies = [];
