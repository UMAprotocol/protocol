import { Provider } from "@ethersproject/providers";
import { ContractFactory, ContractTransaction, Signer, utils } from "ethers";
import { time as hardhatTime } from "@nomicfoundation/hardhat-network-helpers";
import { ContractName, getAbi, getBytecode } from "@uma/contracts-node";
import hre from "hardhat";

export async function getContractFactory(contractName: ContractName, signer?: Signer): Promise<ContractFactory> {
  const contractAbi = getAbi(contractName);
  const contractBytecode = getBytecode(contractName);
  return new ContractFactory(contractAbi, contractBytecode, signer);
}

export const { formatBytes32String, parseUnits, toUtf8Bytes, toUtf8String } = utils;

export { ContractTransaction, hardhatTime, hre, Provider, Signer };
