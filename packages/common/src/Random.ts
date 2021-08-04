import Web3 from "web3";
import { BN } from "./types";

export function getRandomSignedInt(): BN {
  const unsignedValue = getRandomUnsignedInt();

  // The signed range is just the unsigned range decreased by 2^255.
  const signedOffset = Web3.utils.toBN(2).pow(Web3.utils.toBN(255));
  return unsignedValue.sub(signedOffset);
}

// Generate a random unsigned 256 bit int.
export function getRandomUnsignedInt(): BN {
  return Web3.utils.toBN(Web3.utils.randomHex(32));
}
