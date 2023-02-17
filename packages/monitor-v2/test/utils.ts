import hre from "hardhat";
import { ContractFactory, Signer, utils } from "ethers";
import { ContractName, getAbi, getBytecode } from "@uma/contracts-node";

export async function getContractFactory(contractName: ContractName, signer?: Signer): Promise<ContractFactory> {
  const contractAbi = getAbi(contractName);
  const contractBytecode = getBytecode(contractName);
  return new ContractFactory(contractAbi, contractBytecode, signer);
}

export const parseUnits = utils.parseUnits;

export const formatBytes32String = utils.formatBytes32String;

export { hre, Signer };
