import { TimerEthers } from "@uma/contracts-node";
import { hre } from "../utils";

const ethers = hre.ethers;

export const advanceTimerPastLiveness = async (timer: TimerEthers, fromBlockNumber: number, liveness: number) => {
  const block = await ethers.provider.getBlock(fromBlockNumber);
  await (await timer.setCurrentTime(block.timestamp + liveness)).wait();
};
