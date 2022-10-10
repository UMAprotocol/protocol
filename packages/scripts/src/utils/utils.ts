const hre = require("hardhat");
const { ethers } = hre;

export const increaseEvmTime = async (time: number): Promise<void> => {
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine", []);
};
