const func = async function (hre) {
  const { deployments, getNamedAccounts, companionNetworks } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Grab parent messenger address:
  const { deployments: l1Deployments } = companionNetworks["mainnet"];
  const parentMessenger = await l1Deployments.get("Optimism_ParentMessenger");
  console.log(`Using l1 parent messenger @ ${parentMessenger.address}`);

  await deploy("Optimism_ChildMessenger", {
    contract: "Optimism_ChildMessenger",
    from: deployer,
    args: [parentMessenger.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["OptimismChildMessenger", "l2-optimism-xchain"];
