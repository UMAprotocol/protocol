import assert from "assert";
import { ethers } from "ethers";
import sortedLastIndexBy from "lodash/sortedLastIndexBy";
import { ignoreExistenceError } from "./errors";
// this request id does not include chain id
export { requestId } from "../clients/optimisticOracle";

import {
  State,
  RequestState,
  Flag,
  Flags,
  PartialChainConfig,
  ChainConfig,
  PartialConfig,
  ChainMetadata,
  Config,
  OracleType,
} from "./types/state";
import type { Provider, TransactionReceipt, BigNumberish } from "./types/ethers";
import { ContextType } from "./types/statemachine";
import { Read } from "./store";

export const getAddress = ethers.utils.getAddress;
export const hexValue = ethers.utils.hexValue;

export function initFlags(): Flags {
  return {
    [Flag.MissingRequest]: false,
    [Flag.MissingUser]: false,
    [Flag.WrongChain]: false,
    [Flag.CanPropose]: false,
    [Flag.CanDispute]: false,
    [Flag.CanSettle]: false,
    [Flag.InDvmVote]: false,
    [Flag.RequestSettled]: false,
    [Flag.InsufficientBalance]: false,
    [Flag.InsufficientApproval]: false,
    [Flag.ProposalTxInProgress]: false,
    [Flag.ApprovalTxInProgress]: false,
    [Flag.DisputeTxInProgress]: false,
    [Flag.ChainChangeInProgress]: false,
  };
}

export const nowS = (now = Date.now()): number => Math.floor(now / 1000);

// reduce global state into important UI boolean states. this should never throw errors.
export function getFlags(state: State): Record<Flag, boolean> {
  const read = new Read(state);
  const flags = initFlags();

  const signer = ignoreExistenceError(read.signer);
  flags[Flag.MissingUser] = signer ? false : true;

  const inputRequest = ignoreExistenceError(read.inputRequest);
  flags[Flag.MissingRequest] = inputRequest ? false : true;

  const userChainId = ignoreExistenceError(read.userChainId);
  const requestChainId = ignoreExistenceError(read.requestChainId);
  flags[Flag.WrongChain] = userChainId && requestChainId ? userChainId !== requestChainId : false;

  const request = ignoreExistenceError(read.request);

  // these are a bit redundant with request state, but just an alternate way to see current request state
  flags[Flag.CanPropose] = request?.state === RequestState.Requested;
  flags[Flag.CanDispute] = request?.state === RequestState.Proposed;
  flags[Flag.CanSettle] = request?.state === RequestState.Resolved || request?.state === RequestState.Expired;
  flags[Flag.InDvmVote] = request?.state === RequestState.Disputed;
  flags[Flag.RequestSettled] = request?.state === RequestState.Settled;

  if (request && request.bond && request.finalFee) {
    const totalBond = request.bond.add(request.finalFee);
    const userCollateralBalance = ignoreExistenceError(read.userCollateralBalance);
    const userCollateralAllowance = ignoreExistenceError(read.userCollateralAllowance);
    flags[Flag.InsufficientBalance] = userCollateralBalance ? userCollateralBalance.lt(totalBond) : false;
    flags[Flag.InsufficientApproval] = userCollateralAllowance ? userCollateralAllowance.lt(totalBond) : false;
  }

  const userAddress = ignoreExistenceError(read.userAddress);
  const commands = ignoreExistenceError(() => read.filterCommands({ done: false, user: userAddress }));
  if (userAddress && commands) {
    commands.forEach((command) => {
      if (!flags[Flag.ProposalTxInProgress] && command.type === ContextType.proposePrice) {
        flags[Flag.ProposalTxInProgress] = true;
      }
      if (!flags[Flag.DisputeTxInProgress] && command.type === ContextType.disputePrice) {
        flags[Flag.DisputeTxInProgress] = true;
      }
      if (!flags[Flag.ApprovalTxInProgress] && command.type === ContextType.approve) {
        flags[Flag.ApprovalTxInProgress] = true;
      }
      if (!flags[Flag.ChainChangeInProgress] && command.type === ContextType.switchOrAddChain) {
        flags[Flag.ChainChangeInProgress] = true;
      }
    });
  }

  return flags;
}

export function getMulticall2Address(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "4":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "5":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "42":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    default:
      throw new Error(`No address found for deployment Multicall2 on chainId ${chainId}`);
  }
}
type AddressGetter = (chainId: number) => string;
interface AddressGetters {
  getMulticall2Address: AddressGetter;
}

export const DefaultChainConfig = ({ getMulticall2Address }: AddressGetters) => (
  chainId: number,
  chainConfig: PartialChainConfig
): ChainConfig => {
  let multicall2Address = chainConfig.multicall2Address;
  try {
    multicall2Address = multicall2Address || getMulticall2Address(chainId);
  } catch (err) {
    // ignore, multicall optional
  }

  const checkTxIntervalSec = chainConfig.checkTxIntervalSec || 5;

  return {
    ...chainConfig,
    chainId,
    multicall2Address,
    checkTxIntervalSec,
  };
};

export const DefaultConfig = (getters: AddressGetters) => (config: PartialConfig, oracleType: OracleType): Config => {
  return Object.entries(config.chains).reduce(
    (config: Config, [chainId, chainConfig]) => {
      config.chains[Number(chainId)] = DefaultChainConfig(getters)(Number(chainId), chainConfig);
      return config;
    },
    { ...config, chains: {}, oracleType }
  );
};

export class TransactionConfirmer {
  constructor(private provider: Provider) {}
  async getReceipt(hash: string): Promise<TransactionReceipt> {
    return this.provider.getTransactionReceipt(hash);
  }
  async isConfirmed(hash: string, confirmations = 1): Promise<false | TransactionReceipt> {
    try {
      const receipt = await this.getReceipt(hash);
      if (receipt.confirmations >= confirmations) return receipt;
    } catch (err) {
      // do nothing
    }
    return false;
  }
}

export function chainConfigToChainMetadata(config: ChainConfig): ChainMetadata {
  const {
    // remove extra fields
    checkTxIntervalSec,
    multicall2Address,
    optimisticOracleAddress,
    earliestBlockNumber,
    maxEventRangeQuery,
    ...chainMetadata
  } = config;
  return chainMetadata;
}

// This state is meant for adjusting a start/end block when querying events. Some apis will fail if the range
// is too big, so the following functions will adjust range dynamically.
export type RangeState = {
  startBlock: number;
  endBlock: number;
  maxRange: number;
  currentRange: number;
  currentStart: number; // This is the start value you want for your query.
  currentEnd: number; // this is the end value you want for your query.
  done: boolean; // Signals we successfully queried the entire range.
  multiplier?: number; // Multiplier increases or decreases range by this value, depending on success or failure
};

/**
 * rangeStart. This starts a new range query and sets defaults for state.  Use this as the first call before starting your queries
 *
 * @param {Pick} state
 * @returns {RangeState}
 */
export function rangeStart(
  state: Pick<RangeState, "startBlock" | "endBlock" | "multiplier"> & { maxRange?: number }
): RangeState {
  const { startBlock, endBlock, multiplier = 2 } = state;
  if (state.maxRange && state.maxRange > 0) {
    const range = endBlock - startBlock;
    assert(range > 0, "End block must be higher than start block");
    const currentRange = Math.min(state.maxRange, range);
    const currentStart = endBlock - currentRange;
    const currentEnd = endBlock;
    return {
      done: false,
      startBlock,
      endBlock,
      maxRange: state.maxRange,
      currentRange,
      currentStart,
      currentEnd,
      multiplier,
    };
  } else {
    // the largest range we can have, since this is the users query for start and end
    const maxRange = endBlock - startBlock;
    assert(maxRange > 0, "End block must be higher than start block");
    const currentStart = startBlock;
    const currentEnd = endBlock;
    const currentRange = maxRange;

    return {
      done: false,
      startBlock,
      endBlock,
      maxRange,
      currentRange,
      currentStart,
      currentEnd,
      multiplier,
    };
  }
}
/**
 * rangeSuccessDescending. We have 2 ways of querying events, from oldest to newest, or newest to oldest. Typically we want them in order, from
 * oldest to newest, but for this particular case we want them newest to oldest, ie descending ( larger timestamp to smaller timestamp).
 * This function will increase the range between start/end block and return a new start/end to use since by calling this you are signalling
 * that the last range ended in a successful query.
 *
 * @param {RangeState} state
 * @returns {RangeState}
 */
export function rangeSuccessDescending(state: RangeState): RangeState {
  const { startBlock, currentStart, maxRange, currentRange, multiplier = 2 } = state;
  // we are done if we succeeded querying where the currentStart matches are initial start block
  const done = currentStart <= startBlock;
  // increase range up to max range for every successful query
  const nextRange = Math.min(Math.ceil(currentRange * multiplier), maxRange);
  // move our end point to the previously successful start, ie moving from newest to oldest
  const nextEnd = currentStart;
  // move our start block to the next range down
  const nextStart = Math.max(nextEnd - nextRange, startBlock);
  return {
    ...state,
    currentStart: nextStart,
    currentEnd: nextEnd,
    currentRange: nextRange,
    done,
  };
}
/**
 * rangeFailureDescending. Like the previous function, this will decrease the range between start/end for your query, because you are signalling
 * that the last query failed. It will also keep the end of your range the same, while moving the start range up. This is why
 * its considered descending, it will attempt to move from end to start, rather than start to end.
 *
 * @param {RangeState} state
 * @returns {RangeState}
 */
export function rangeFailureDescending(state: RangeState): RangeState {
  const { startBlock, currentEnd, currentRange, multiplier = 2 } = state;
  const nextRange = Math.floor(currentRange / multiplier);
  // this will eventually throw an error if you keep calling this function, which protects us against re-querying a broken api in a loop
  assert(nextRange > 0, "Range must be above 0");
  // we stay at the same end block
  const nextEnd = currentEnd;
  // move our start block closer to the end block, shrinking the range
  const nextStart = Math.max(nextEnd - nextRange, startBlock);
  return {
    ...state,
    currentStart: nextStart,
    currentEnd: nextEnd,
    currentRange: nextRange,
  };
}

/**
 * eventKey. Make a unique and sortable identifier string for an event
 *
 * @param {Event} event
 * @returns {string} - the unique id
 */
export function eventKey(event: {
  blockNumber: BigNumberish;
  transactionIndex: BigNumberish;
  logIndex: BigNumberish;
}): string {
  return [
    // we pad these because numbers of varying lengths will not sort correctly, ie "10" will incorrectly sort before "9", but "09" will be correct.
    event.blockNumber.toString().padStart(16, "0"),
    event.transactionIndex.toString().padStart(16, "0"),
    event.logIndex?.toString().padStart(16, "0"),
    // ~ is the last printable ascii char, so it does not interfere with sorting
  ].join("~");
}
/**
 * insertOrdered. Inserts items in an array maintaining sorted order, in this case lowest to highest. Does not check duplicates.
 * Mainly used for caching all known events, in order of oldest to newest.
 *
 * @param {T[]} array
 * @param {T} element
 * @param {Function} orderBy
 */
export function insertOrderedAscending<T>(array: T[], element: T, orderBy: (element: T) => string | number): T[] {
  const index = sortedLastIndexBy(array, element, orderBy);
  array.splice(index, 0, element);
  return array;
}
export function isUnique<T>(array: T[], element: T, id: (element: T) => string | number): boolean {
  const elementId = id(element);
  const found = array.find((next: T) => {
    return id(next) === elementId;
  });
  return found === undefined;
}

export function isSupportedOracleType(oracleType: string): oracleType is OracleType {
  return oracleType in OracleType;
}
