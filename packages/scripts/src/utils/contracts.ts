import { ContractName, DeploymentName, getAddress } from "@uma/contracts-node";
const hre = require("hardhat");
import { Contract } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";

export const getContractInstance = async <T>(
  contractName: DeploymentName | ContractName,
  address?: string,
  chainId?: number
): Promise<T> => {
  const networkId = chainId ? chainId : await hre.getChainId();
  const contractAddress = address !== undefined ? address : await getAddress(contractName, Number(networkId));
  return hre.ethers.getContractAt(contractName, contractAddress) as T;
};

export const getContractInstanceByUrl = async <T extends Contract>(
  contractName: DeploymentName | ContractName,
  rpcUrl: string
): Promise<T> => {
  const provider: Provider = new hre.ethers.providers.JsonRpcProvider(rpcUrl);
  const networkId = (await provider.getNetwork()).chainId;
  const contractAddress = await getAddress(contractName, Number(networkId));
  return hre.ethers.getContractAt(contractName, contractAddress) as T;
};
