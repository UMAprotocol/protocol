const { getAddress } = require("@uma/contracts-node");
const hre = require("hardhat");

export const getContractInstance = async <T>(contractName: string): Promise<T> => {
  const networkId = await hre.getChainId();
  const factory = await hre.ethers.getContractFactory(contractName);
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)) as T;
};
