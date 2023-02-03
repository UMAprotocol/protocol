const hre = require("hardhat");
const { ethers } = hre;
import { JsonRpcProvider } from "@ethersproject/providers";
import { BigNumber } from "ethers";

export const increaseEvmTime = async (time: number): Promise<void> => {
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine", []);
};

export const takeSnapshot = async (): Promise<string> => {
  const snapshot = await ethers.provider.send("evm_snapshot", []);
  return snapshot;
};

export const revertToSnapshot = async (snapshotId: string): Promise<void> => {
  await ethers.provider.send("evm_revert", [snapshotId]);
};

export const forkNetwork = (jsonRpcUrl: string, blockNumber?: string): Promise<void> => {
  return hre.network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl, blockNumber } }],
  });
};

export const getForkChainId = async (jsonRpcUrl: string): Promise<number> => {
  const provider = new JsonRpcProvider(jsonRpcUrl);
  return (await provider.getNetwork()).chainId;
};

export const bigNumberAbsDiff = (a: BigNumber, b: BigNumber): BigNumber => {
  return a.gt(b) ? a.sub(b) : b.sub(a);
};

export const getChainIdByUrl = async (jsonRpcUrl: string): Promise<number> => {
  const provider = new ethers.providers.JsonRpcProvider(jsonRpcUrl);
  return (await provider.getNetwork()).chainId;
};

export const getLatestBlockNumberByUrl = async (jsonRpcUrl: string): Promise<number> => {
  const provider = new ethers.providers.JsonRpcProvider(jsonRpcUrl);
  return await provider.getBlockNumber();
};
