const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Blast_ParentMessenger", {
    contract: "Optimism_ParentMessenger",
    from: deployer,
    args: [
      "0x5D4472f31Bd9385709ec61305AFc749F0fA8e9d0", // Blast's OVM L1 Cross Domain Messenger
      81457, // Child network ID
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Blast_ParentMessenger", "l1-blast-xchain"];
