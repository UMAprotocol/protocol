const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Optimism_ParentMessenger", {
    contract: "Optimism_ParentMessenger",
    from: deployer,
    args: [
      "0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1", // Optimism's OVM L1 Cross Domain Messenger
      10, // Child network ID
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["OptimismParentMessenger", "l1-optimism-xchain"];
