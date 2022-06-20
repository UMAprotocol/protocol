const { getAddress } = require("@uma/contracts-node");
const hre = require("hardhat");
import { Contract, ContractFactory } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";

export const getContractInstance = async <T>(contractName: string): Promise<T> => {
  const networkId = await hre.getChainId();
  const factory = await hre.ethers.getContractFactory(contractName);
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)) as T;
};

export const getContractInstanceNetwork = async <T extends Contract>(
  contractName: string,
  rpcUrl: string
): Promise<T> => {
  const provider: Provider = new hre.ethers.providers.JsonRpcProvider(rpcUrl);
  const networkId = (await provider.getNetwork()).chainId;
  const factory: ContractFactory = await hre.ethers.getContractFactory(contractName);
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)).connect(provider) as T;
};
