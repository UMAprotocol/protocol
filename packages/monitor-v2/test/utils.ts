import { Provider } from "@ethersproject/providers";
import { time as hardhatTime } from "@nomicfoundation/hardhat-network-helpers";
import { ContractName, getAbi, getBytecode } from "@uma/contracts-node";
import { ContractFactory, ContractTransaction, Signer, utils } from "ethers";
import hre from "hardhat";

export async function getContractFactory(contractName: ContractName, signer?: Signer): Promise<ContractFactory> {
  const contractAbi = getAbi(contractName);
  const contractBytecode = getBytecode(contractName);
  return new ContractFactory(contractAbi, contractBytecode, signer);
}

// Get block number from transaction (or 0 if transaction is not mined).
export const getBlockNumberFromTx = async (tx: ContractTransaction): Promise<number> => {
  await tx.wait();
  const blockNumber = tx.blockNumber ? tx.blockNumber : 0;
  return blockNumber;
};

export const { formatBytes32String, parseUnits, toUtf8Bytes, toUtf8String } = utils;

export { ContractTransaction, hardhatTime, hre, Provider, Signer };
