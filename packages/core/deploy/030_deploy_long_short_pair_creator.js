const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const TokenFactory = await deployments.get("TokenFactory");
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  await deploy("LongShortPairCreator", {
    from: deployer,
    args: ["0xeD0169a88d267063184b0853BaAAAe66c3c154B2", "0x29aBe06dB681c0effB6C8892E0028cfe24baAfdf", "0x0000000000000000000000000000000000000000"],
    log: true,
  });
};
module.exports = func;
func.tags = ["LongShortPairCreator", "lsp"];
func.dependencies = ["Finder", "TokenFactory", "Timer"];
