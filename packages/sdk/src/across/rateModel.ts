import { expectedRateModelKeys, RateModel } from "./constants";
import { exists } from "../utils";
import { ethers } from "ethers";

// Each L1 token is mapped to an array of stringified rate models, ordered by the block height at which they were
// published on-chain. This dictionary is used internally to fetch a rate model for a block height.
type RateModelEventsDictionary = {
  [l1TokenAddress: string]: { blockNumber: number; rateModel: string }[];
};

// Events should be reformatted into this shape to be used as input into methods in this file.
export type RateModelEvent = {
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  rateModel: string;
  l1Token: string;
};

export class RateModelDictionary {
  public rateModelDictionary: RateModelEventsDictionary = {};

  private _throwIfNotInitialized() {
    if (Object.keys(this.rateModelDictionary).length == 0)
      throw new Error("RateModelUtility method called before updating rate model dictionary!");
  }

  updateWithEvents(rateModelEvents: RateModelEvent[]): void {
    this.rateModelDictionary = createRateModelEventDictionary(rateModelEvents);
  }

  /**
   * Return the rate model for L1 token set at the block height.
   * @param l1Token L1 token address to get rate model for.
   * @param blockNumber Block height to get rate model for.
   * @returns Rate model object.
   */
  getRateModelForBlockNumber(l1Token: string, blockNumber?: number): RateModel {
    this._throwIfNotInitialized();

    const l1TokenNormalized = ethers.utils.getAddress(l1Token);

    if (!this.rateModelDictionary[l1TokenNormalized] || this.rateModelDictionary[l1TokenNormalized].length === 0)
      throw new Error(`No updated rate model events for L1 token: ${l1TokenNormalized}`);

    if (!blockNumber) {
      // If block number is undefined, use latest updated rate model.
      return parseAndReturnRateModelFromString(this.rateModelDictionary[l1TokenNormalized].slice(-1)[0].rateModel);
    } else {
      const firstEventBlockNumber = this.rateModelDictionary[l1TokenNormalized][0].blockNumber;
      if (blockNumber < firstEventBlockNumber) {
        throw new Error(
          `Block number #${blockNumber} is before first UpdatedRateModel event block ${firstEventBlockNumber}`
        );
      }

      // We're looking for the latest rate model update that occurred at or before the block number.
      // Rate model events are inserted into the array from oldest at index 0 to newest at index length-1, so we'll
      // reverse the array so it goes from newest at index 0 to oldest at index length-1, and then find the first event
      // who's block number is less than or equal to the target block number.
      const rateModel = this.rateModelDictionary[l1TokenNormalized]
        .slice()
        .reverse() // reverse() modifies memory in place so create a copy first.
        .find((event) => event.blockNumber <= blockNumber);

      if (!rateModel)
        throw new Error(`No updated rate model events before block #${blockNumber} for L1 token: ${l1TokenNormalized}`);
      return parseAndReturnRateModelFromString(rateModel?.rateModel);
    }
  }

  /**
   * @notice Return all L1 tokens that had a rate model associated with it at the block number.
   * @param blockNumber Returns l1 tokens that were mapped to a rate model at this block height. If undefined,
   * this function will return all L1 tokens that have a block number as of the latest block height.
   * @returns array of L1 token addresses.
   */
  getL1TokensFromRateModel(blockNumber: number | undefined = undefined): string[] {
    this._throwIfNotInitialized();

    return Object.keys(this.rateModelDictionary)
      .map((l1Token) => {
        const l1TokenNormalized = ethers.utils.getAddress(l1Token);

        // Check that there is at least one UpdatedRateModel event before the provided block number, otherwise
        // this L1 token didn't exist in the RateModel at the block height and we shouldn't include it in the returned
        // array.
        if (
          !blockNumber ||
          this.rateModelDictionary[l1TokenNormalized].find((event) => event.blockNumber <= blockNumber)
        )
          return ethers.utils.getAddress(l1Token);
        else return null;
      })
      .filter(exists);
  }
}
/**
 * Helper method that returns parsed rate model from string, or throws.
 * @param rateModelString Stringified rate model to parse.
 * @returns Rate model object. Must conform to `expectedRateModelKeys` format.
 */

export const parseAndReturnRateModelFromString = (rateModelString: string): RateModel => {
  const rateModelFromEvent = JSON.parse(rateModelString);

  // Rate model must contain the exact same keys in `expectedRateModelKeys`.
  for (const key of expectedRateModelKeys) {
    if (!Object.keys(rateModelFromEvent).includes(key)) {
      throw new Error(
        `Rate model does not contain all expected keys. Expected keys: [${expectedRateModelKeys}], actual keys: [${Object.keys(
          rateModelFromEvent
        )}]`
      );
    }
  }
  for (const key of Object.keys(rateModelFromEvent)) {
    if (!expectedRateModelKeys.includes(key)) {
      throw new Error(
        `Rate model contains unexpected keys. Expected keys: [${expectedRateModelKeys}], actual keys: [${Object.keys(
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
 * Given an unsorted array of updated rate model events, return a dictionary mapping token addresses to sorted
 * rate model events. This method is used internally to enforce chronological sorting of events and mapping rate models
 * to token addresses.
 * @param rateModelEvents Unsorted updated rate model events, each of which contains a token address, the stringified
 * rate model for that token, and the block height of the update.
 * @returns Dictionary mapping token addresses to chronologically sorted rate model updates.
 */
const createRateModelEventDictionary = (rateModelEvents: RateModelEvent[]): RateModelEventsDictionary => {
  const updatedRateModelEventsForToken: RateModelEventsDictionary = {};

  // Sort events in-place from oldest to newest:
  rateModelEvents.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }

    if (a.transactionIndex !== b.transactionIndex) {
      return a.transactionIndex - b.transactionIndex;
    }

    return a.logIndex - b.logIndex;
  });

  for (const updatedRateModelEvent of rateModelEvents) {
    // The contract enforces that all rate models are mapped to addresses, therefore we do not need to check that
    // `l1Token` is a valid address.
    const l1TokenNormalized = ethers.utils.getAddress(updatedRateModelEvent.l1Token);
    if (!updatedRateModelEventsForToken[l1TokenNormalized]) updatedRateModelEventsForToken[l1TokenNormalized] = [];

    // We assume that events are returned from oldest to newest, so we can simply push events into the array and
    // and maintain their time order.
    updatedRateModelEventsForToken[l1TokenNormalized].push({
      blockNumber: updatedRateModelEvent.blockNumber,
      rateModel: updatedRateModelEvent.rateModel,
    });
  }

  return updatedRateModelEventsForToken;
};
