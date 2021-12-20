import { expectedRateModelKeys, RateModel } from "./constants";
import { exists } from "../utils";
import { ethers } from "ethers";

// Maps L1 token to array of dictionaries mapping UpdatedRateModel event block numbers to the stringified rate model.
export type RateModelEventsByBlock = {
  [l1TokenAddress: string]: { blockNumber: number; rateModel: string }[];
};

/**
 * Helper method that returns parsed rate model from string, or throws.
 * @param rateModelString Stringified rate model to parse.
 * @returns Rate model object. Must conform to `expectedRateModelKeys` format.
 */

export const parseAndReturnRateModelFromString = (rateModelString: string): RateModel => {
  const rateModelFromEvent = JSON.parse(rateModelString);

  // Rate model must contain all keys in `expectedRateModelKeys`, and extra keys are OK.
  for (const key in expectedRateModelKeys) {
    if (!(key in Object.keys(rateModelFromEvent))) {
      throw new Error(
        `Rate model does not contain all expected keys. Expected keys: [${expectedRateModelKeys}], actual keys: [${Object.keys(
          rateModelFromEvent
        )}]`
      );
    }
  }

  return {
    UBar: rateModelFromEvent.UBar,
    R0: rateModelFromEvent.R0,
    R1: rateModelFromEvent.R1,
    R2: rateModelFromEvent.R2,
  };
};

/**
 * Return the rate model for L1 token set at the block height.
 * @param rateModelEvents RateModels keyed by L1 token and block height.
 * @param l1Token L1 token address to get rate model for.
 * @param blockNumber Block height to get rate model for.
 * @returns Rate model object.
 */
export const getRateModelForBlockNumber = (
  rateModelEvents: RateModelEventsByBlock,
  l1Token: string,
  blockNumber: number | undefined = undefined
): RateModel => {
  const l1TokenNormalized = ethers.utils.getAddress(l1Token);

  if (!rateModelEvents[l1TokenNormalized] || rateModelEvents[l1TokenNormalized].length === 0)
    throw new Error(`No updated rate model events for L1 token: ${l1TokenNormalized}`);

  if (!blockNumber) {
    // If block number is undefined, use latest updated rate model.
    return parseAndReturnRateModelFromString(rateModelEvents[l1TokenNormalized].slice(-1)[0].rateModel);
  } else {
    const firstEventBlockNumber = rateModelEvents[l1TokenNormalized][0].blockNumber;
    if (blockNumber < firstEventBlockNumber) {
      throw new Error(
        `Block number #${blockNumber} is before first UpdatedRateModel event block ${firstEventBlockNumber}`
      );
    }

    // We're looking for the latest rate model update that occurred at or before the block number.
    // Rate model events are inserted into the array from oldest at index 0 to newest at index length-1, so we'll
    // reverse the array so it goes from newest at index 0 to oldest at index length-1, and then find the first event
    // who's block number is less than or equal to the target block number.
    const rateModel = rateModelEvents[l1TokenNormalized]
      .slice() // reverse() modifies memory in place so create a copy first.
      .reverse()
      .find((event) => event.blockNumber <= blockNumber);

    if (!rateModel)
      throw new Error(`No updated rate model events before block #${blockNumber} for L1 token: ${l1TokenNormalized}`);
    return parseAndReturnRateModelFromString(rateModel?.rateModel);
  }
};

/**
 * @notice Return all L1 tokens that had a rate model associated with it at the block number.
 * @param rateModelEvents RateModels keyed by L1 token and block height.
 * @param blockNumber Returns l1 tokens that were mapped to a rate model at this block height. If undefined,
 * this function will return all L1 tokens that have a block number as of the latest block height.
 * @returns array of L1 token addresses.
 */
export const getL1TokensFromRateModel = (
  rateModelEvents: RateModelEventsByBlock,
  blockNumber: number | undefined = undefined
): string[] => {
  return Object.keys(rateModelEvents)
    .map((l1Token) => {
      const l1TokenNormalized = ethers.utils.getAddress(l1Token);

      // Check that there is at least one UpdatedRateModel event before the provided block number, otherwise
      // this L1 token didn't exist in the RateModel at the block height and we shouldn't include it in the returned
      // array.
      if (!blockNumber || rateModelEvents[l1TokenNormalized].find((event) => event.blockNumber <= blockNumber))
        return ethers.utils.getAddress(l1Token);
      else return null;
    })
    .filter(exists);
};
