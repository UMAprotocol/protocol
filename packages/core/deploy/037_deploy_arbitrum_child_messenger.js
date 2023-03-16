const func = async function (hre) {
  const { deployments, getNamedAccounts, companionNetworks } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Grab parent messenger address:
  // Default to pulling from this chain if the companion network doesn't exist.
  if (!companionNetworks["mainnet"])
    console.error(
      "WARNING: attempting to use same chain for mainnet and arbitrum contracts because mainnet companion network doesn't exist."
    );
  const { deployments: l1Deployments } = companionNetworks["mainnet"] || hre;
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
