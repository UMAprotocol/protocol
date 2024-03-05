// Custom settings based on network. We don't want to update hardcoded values in deploy script as tests depend on them.
const CUSTOM_PARAMETERS = {
  1: { baseSlashAmountEther: "0.001" },
  11155111: { baseSlashAmountEther: "0.001" },
};

const func = async function (hre) {
  const { deployments, getNamedAccounts, web3, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const customParameters = chainId in CUSTOM_PARAMETERS;

  // baseSlashAmount: amount slashed for missing a vote or voting wrong.
  const baseSlashAmountEther = customParameters ? CUSTOM_PARAMETERS[chainId].baseSlashAmountEther : "0.0016";
  const baseSlashAmount = web3.utils.toWei(baseSlashAmountEther, "ether");

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
