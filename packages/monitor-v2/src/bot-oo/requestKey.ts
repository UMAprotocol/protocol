import { ethers } from "ethers";

export type RequestKeyArgs = {
  requester: string;
  identifier: string;
  timestamp: ethers.BigNumber;
  ancillaryData: string;
};

export const requestKey = (args: RequestKeyArgs): string =>
  ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["address", "bytes32", "uint256", "bytes"],
      [args.requester, args.identifier, args.timestamp, args.ancillaryData]
    )
  );

// Identifies a proposal by the transaction hash and log index of its ProposePrice event. This is the
// identifier used by the settlement include list (matches how proposals are referenced in the explorer).
export const proposalEventId = (transactionHash: string, logIndex: number): string =>
  `${transactionHash.toLowerCase()}:${logIndex}`;
