import { ContractName, DeploymentName, getAddress } from "@uma/contracts-node";
const hre = require("hardhat");
import { Contract } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";

export const FOUNDATION_WALLET = "0x8180d59b7175d4064bdfa8138a58e9babffda44a";
export const SECONDS_PER_DAY = 86400;
export const YES_VOTE = "1";

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
