import { Provider } from "@ethersproject/providers";
import { time as hardhatTime } from "@nomicfoundation/hardhat-network-helpers";
import { VotePhasesEnum } from "@uma/common";
import { ContractName, getAbi, getBytecode, VotingV2Ethers } from "@uma/contracts-node";
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
  return tx.blockNumber !== undefined ? tx.blockNumber : 0;
};

// Moves the voting contract to the first phase of the next round.
export const moveToNextRound = async (voting: VotingV2Ethers): Promise<void> => {
  const phase = await voting.getVotePhase();
  const phaseLength = await voting.voteTiming();

  let timeIncrement;
  if (phase.toString() === VotePhasesEnum.COMMIT) {
    // Commit phase, so it will take 2 days to move to the next round.
    timeIncrement = phaseLength.mul(2);
  } else {
    // Reveal phase, so it will take 1 day to move to the next round.
    timeIncrement = phaseLength;
  }
  await hardhatTime.increase(timeIncrement);
};

export const moveToNextPhase = async (voting: VotingV2Ethers): Promise<void> => {
  const phaseLength = await voting.voteTiming();
  const currentRoundId = await voting.getCurrentRoundId();
  const roundEndTime = await voting.getRoundEndTime(currentRoundId);

  await hardhatTime.setNextBlockTimestamp(roundEndTime.sub(phaseLength));
};

export const { formatBytes32String, parseBytes32String, parseUnits, parseEther, toUtf8Bytes, toUtf8String } = utils;

export { ContractTransaction, hardhatTime, hre, Provider, Signer };
