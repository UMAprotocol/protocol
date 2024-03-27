const func = async function (hre) {
  const { deployments, getNamedAccounts, companionNetworks } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Grab parent messenger address:
  // Default to pulling from this chain if the companion network doesn't exist.
  if (!companionNetworks["mainnet"])
    console.error(
      "WARNING: attempting to use same chain for mainnet and base contracts because mainnet companion network doesn't exist."
    );
  const { deployments: l1Deployments } = companionNetworks["mainnet"] || hre;
  const parentMessenger = await l1Deployments.get("Base_ParentMessenger");
  console.log(`Using l1 parent messenger @ ${parentMessenger.address}`);

  await deploy("Base_ChildMessenger", {
    contract: "Optimism_ChildMessenger",
    from: deployer,
    args: [parentMessenger.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Base_ChildMessenger", "l2-base-xchain"];
