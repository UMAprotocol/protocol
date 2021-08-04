import Web3 from "web3";
import type { BN } from "./types";

interface TopicHashRequest {
  identifier: string;
  time: string | BN;
}

// Web3's soliditySha3 will attempt to auto-detect the type of given input parameters,
// but this won't produce expected behavior for certain types such as `bytes32` or `address`.
// Therefore, these helper methods will explicitly set types.
export function computeTopicHash(request: TopicHashRequest, roundId: number | string): string {
  const hash = Web3.utils.soliditySha3(
    { t: "bytes32", v: request.identifier },
    { t: "uint", v: request.time },
    { t: "uint", v: roundId }
  );
  if (hash === null) throw new Error("Returned null hash.");
  return hash;
}

interface VoteHashRequest {
  price: string | BN;
  salt: string | BN;
  account: string;
  time: string | BN | number;
  roundId: string | BN | number;
  identifier: string;
}

export function computeVoteHash(request: VoteHashRequest): string {
  const hash = Web3.utils.soliditySha3(
    { t: "int", v: request.price },
    { t: "int", v: request.salt },
    { t: "address", v: request.account },
    { t: "uint", v: request.time },
    { t: "bytes", v: "0x" },
    { t: "uint", v: request.roundId },
    { t: "bytes32", v: request.identifier }
  );
  if (hash === null) throw new Error("Returned null hash.");
  return hash;
}

interface VoteHashAncillaryRequest extends VoteHashRequest {
  ancillaryData: string;
}

export function computeVoteHashAncillary(request: VoteHashAncillaryRequest): string {
  const hash = Web3.utils.soliditySha3(
    { t: "int", v: request.price },
    { t: "int", v: request.salt },
    { t: "address", v: request.account },
    { t: "uint", v: request.time },
    { t: "bytes", v: request.ancillaryData },
    { t: "uint", v: request.roundId },
    { t: "bytes32", v: request.identifier }
  );
  if (hash === null) throw new Error("Returned null hash.");
  return hash;
}

export function getKeyGenMessage(roundId: number | string): string {
  // TODO: discuss dApp tradeoffs for changing this to a per-topic hash keypair.
  return `UMA Protocol one time key for round: ${roundId.toString()}`;
}
