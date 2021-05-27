const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const TokenFactory = await deployments.get("TokenFactory");

  const EMPLib = await deploy("ExpiringMultiPartyLib", { from: deployer, log: true });
  await deploy("ExpiringMultiPartyCreator", {
    from: deployer,
    args: [Finder.address, TokenFactory.address, ZERO_ADDRESS],
    libraries: {
      ExpiringMultiPartyLib: EMPLib.address,
    },
    log: true,
  });
};
module.exports = func;
func.tags = ["ExpiringMultiPartyCreator", "emp"];
func.dependencies = ["Finder", "TokenFactory"];
