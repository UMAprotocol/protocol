const func = async function (hre) {
  const { deployments, getNamedAccounts, companionNetworks } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Grab parent messenger address:
  const { deployments: l1Deployments } = companionNetworks["mainnet"];
  const parentMessenger = await l1Deployments.get("Arbitrum_ParentMessenger");
  console.log(`Using l1 parent messenger @ ${parentMessenger.address}`);

  await deploy("Arbitrum_ChildMessenger", {
    from: deployer,
    args: [parentMessenger.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["ArbitrumChildMessenger", "l2-arbitrum-xchain"];
