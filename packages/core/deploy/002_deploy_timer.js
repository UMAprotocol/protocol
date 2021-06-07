const func = async function (hre) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const { live } = network.config;

  if (live === undefined) throw new Error("Network has no live parameter");

  // If live === false, don't deploy a timer.
  if (live === false) {
    await deploy("Timer", {
      from: deployer,
      args: [],
      log: true,
    });
  }
};
module.exports = func;
func.tags = ["Timer", "test"];
