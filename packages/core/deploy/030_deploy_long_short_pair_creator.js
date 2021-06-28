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
    args: [
      "0x40f941E48A552bF496B154Af6bf55725f18D77c3",
      "0x55D8B8c54250f8B5BB192D42Aa746b4C2Ef2d55C",
      "0x0000000000000000000000000000000000000000",
    ],
    log: true,
  });
};
module.exports = func;
func.tags = ["LongShortPairCreator", "lsp"];
func.dependencies = ["Finder", "TokenFactory", "Timer"];
