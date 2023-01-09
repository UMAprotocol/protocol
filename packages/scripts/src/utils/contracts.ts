const { getAddress } = require("@uma/contracts-node");
const hre = require("hardhat");
import { Contract, ContractFactory } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";

export const FOUNDATION_WALLET = "0x8180d59b7175d4064bdfa8138a58e9babffda44a";
export const SECONDS_PER_DAY = 86400;
export const YES_VOTE = "1";

export const getContractInstance = async <T>(contractName: string, address?: string, chainId?: number): Promise<T> => {
  const networkId = chainId ? chainId : await hre.getChainId();
  const factory = await hre.ethers.getContractFactory(contractName);
  if (address) return (await factory.attach(address)) as T;
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)) as T;
};

export const getContractInstanceByUrl = async <T extends Contract>(
  contractName: string,
  rpcUrl: string
): Promise<T> => {
  const provider: Provider = new hre.ethers.providers.JsonRpcProvider(rpcUrl);
  const networkId = (await provider.getNetwork()).chainId;
  const factory: ContractFactory = await hre.ethers.getContractFactory(contractName);
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)).connect(provider) as T;
};
