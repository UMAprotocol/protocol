const func = async function (hre) {
  const chainId = await hre.web3.eth.net.getId();

  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // Maps chainID to optimism cross-domain messenger contract
  const l1ChainIdToMessenger = {
    42: "0x4361d0F75A0186C05f971c566dC6bEa5957483fD", // kovan
    1: "0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1", // mainnet
  };

  await deploy("Optimism_Messenger", { from: deployer, args: [l1ChainIdToMessenger[chainId]], log: true });
};
module.exports = func;
func.tags = ["Optimism_Messenger"];
