const hre = require("hardhat");
const { ethers } = hre;

export const increaseEvmTime = async (time: number): Promise<void> => {
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine", []);
};

export const getChainIdByUrl = async (jsonRpcUrl: string): Promise<number> => {
  const provider = new ethers.providers.JsonRpcProvider(jsonRpcUrl);
  return (await provider.getNetwork()).chainId;
};

export const getLatestBlockNumberByUrl = async (jsonRpcUrl: string): Promise<number> => {
  const provider = new ethers.providers.JsonRpcProvider(jsonRpcUrl);
  return await provider.getBlockNumber();
};
