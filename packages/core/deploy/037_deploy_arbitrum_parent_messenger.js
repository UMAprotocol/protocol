const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Arbitrum_ParentMessenger", {
    from: deployer,
    args: [
      "0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f", // Arbitrum system "inbox" contract
      42161, // Child network ID
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["ArbitrumParentMessenger", "l1-arbitrum-xchain"];
