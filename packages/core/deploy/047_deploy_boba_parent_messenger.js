const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // Note: Boba is a fork of Optimism, so we can deploy the same messenger contracts on Boba as we would on Optimism.
  await deploy("Boba_ParentMessenger", {
    contract: "Optimism_ParentMessenger",
    from: deployer,
    args: [
      "0x6d4528d192db72e282265d6092f4b872f9dff69e", // Boba's OVM L1 Cross Domain Messenger
      288, // Child network ID
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["BobaParentMessenger", "l1-boba-xchain"];
