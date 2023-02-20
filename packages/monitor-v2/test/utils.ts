import hre from "hardhat";
import { ContractFactory, Signer, utils } from "ethers";
import { ContractName, getAbi, getBytecode } from "@uma/contracts-node";
import { time as hardhatTime } from "@nomicfoundation/hardhat-network-helpers";

export async function getContractFactory(contractName: ContractName, signer?: Signer): Promise<ContractFactory> {
  const contractAbi = getAbi(contractName);
  const contractBytecode = getBytecode(contractName);
  return new ContractFactory(contractAbi, contractBytecode, signer);
}

export const parseUnits = utils.parseUnits;

export const formatBytes32String = utils.formatBytes32String;

export const toUtf8Bytes = utils.toUtf8Bytes;

export { hardhatTime, hre, Signer };
