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
