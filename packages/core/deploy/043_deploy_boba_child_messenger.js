const func = async function (hre) {
  const { deployments, getNamedAccounts, companionNetworks } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Grab parent messenger address:
  // Default to pulling from this chain if the companion network doesn't exist.
  if (!companionNetworks["mainnet"])
    console.error(
      "WARNING: attempting to use same chain for mainnet and boba contracts because mainnet companion network doesn't exist."
    );
  const { deployments: l1Deployments } = companionNetworks["mainnet"] || hre;
  const parentMessenger = await l1Deployments.get("Boba_ParentMessenger");
  console.log(`Using l1 parent messenger @ ${parentMessenger.address}`);

  // Note: Boba is a fork of Optimism, so we can deploy the same messenger contracts on Boba as we would on Optimism.
  await deploy("Boba_ChildMessenger", {
    contract: "Optimism_ChildMessenger",
    from: deployer,
    args: [parentMessenger.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["BobaChildMessenger", "l2-boba-xchain"];
