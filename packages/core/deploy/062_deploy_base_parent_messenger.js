const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Base_ParentMessenger", {
    contract: "Optimism_ParentMessenger",
    from: deployer,
    args: [
      "0x866E82a600A1414e583f7F13623F1aC5d58b0Afa", // Base's OVM L1 Cross Domain Messenger
      8453, // Child network ID
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Base_ParentMessenger", "l1-base-xchain"];
