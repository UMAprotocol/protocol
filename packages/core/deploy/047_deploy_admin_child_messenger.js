const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Admin Child Messenger does not require a parent messenger.
  await deploy("Admin_ChildMessenger", {
    contract: "Admin_ChildMessenger",
    from: deployer,
    args: [],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["AdminChildMessenger", "l2-admin-xchain"];
