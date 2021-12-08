// The types in this package are broken, so we have to require it.
const contractConstructor_ = require("@truffle/contract");
import type truffleContract_ from "@truffle/contract";
import type { BN } from "./types";
import Web3 from "web3";
import type { provider as Provider } from "web3-core";
import { EventData } from "web3-eth-contract";

// Truffle library types aren't specified correctly. Cast and modify to correct for this.
export interface TruffleInstance {
  [prop: string]: any;
}
export interface TruffleContract extends truffleContract_.Contract {
  setProvider: (provider: Provider) => void;
  at: (address: string) => Promise<TruffleInstance>;
  deployed: () => Promise<TruffleInstance>;
  new: (...args: any[]) => Promise<TruffleInstance>;
  link: (arg: any) => TruffleContract;
  detectNetwork: () => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const truffleContract = contractConstructor_ as (artifact: any) => TruffleContract;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallResult = string | BN | { [key: string]: any };

function isBN(input: CallResult): input is BN {
  return input?.constructor?.name === "BN";
}

/**
 * This is a hack to handle reverts for view/pure functions that don't actually revert on public networks.
 * See https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211 for more
 * info.
 * @param {Object} result Return value from calling a contract's view-only method.
 * @return null if the call reverted or the view method's result.
 */
export const revertWrapper = (result: CallResult): null | CallResult => {
  if (!result) {
    return null;
  }
  const revertValue = "3963877391197344453575983046348115674221700746820753546331534351508065746944";
  if (result.toString() === revertValue) {
    return null;
  }

  if (typeof result !== "string" && !isBN(result)) {
    // Iterate over the properties of the object and see if any match the revert value.
    for (const prop in result) {
      if (!(prop in result) && result[prop].toString() === revertValue) {
        return null;
      }
    }
  }
  return result;
};

/**
 * create a truffle contract from a json object, usually read in from an artifact.
 * @param {*} contractJsonObject json object representing a contract.
 * @param {Object} web3 instance. In unit tests this is globally accessible but when used in production needs injection.
 * @returns truffle contract instance
 */
export const createContractObjectFromJson = (
  contractJsonObject: { [key: string]: any },
  _web3 = ((global as unknown) as { web3: Web3 }).web3
): TruffleContract => {
  const truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(_web3.currentProvider);
  return truffleContractCreator;
};
/**
 * Helper to enable enables library linking on artifacts that were not compiled within this repo, such as artifacts
 * produced by an external project. Can also be useful if the artifact was compiled using ethers.
 * @param {object} artifact representing the compiled contract instance.
 * @param {string} libraryName to be found and replaced within the artifact.
 */
export const replaceLibraryBindingReferenceInArtitifact = <T>(artifact: T, libraryName: string): T => {
  const artifactString = JSON.stringify(artifact);
  return JSON.parse(artifactString.replace(/\$.*\$/g, libraryName));
};

export type EventSearchOptions = {
  fromBlock: number;
  toBlock: number;
  filter?: any; // Object, allows caller to filter events by indexed paramateres. e.g. {filter: {myNumber: [12,13]}}
  // filters all events where "myNumber" is 12 or 13.
};

/**
 * Fetches specified contract event data for all input web3 providers. Returns false if any of the events found with
 * one provider are NOT matched exactly in ALL of the other providers' event arrays.
 * @param web3s Web3 providers to check for target event.
 * @param contractAbi Contract ABI to query target event on.
 * @param contractAddress Contract address to query target event on.
 * @param eventName Name of target event.
 * @param eventSearchOptions Target event search options. See here for more details: https://web3js.readthedocs.io/en/v1.5.2/web3-eth-contract.html#getpastevents
 * @returns Object containing success of event query, missing events not found in all providers, and all event data
 */
export async function getEventsForMultipleProviders(
  web3s: Web3[],
  contractAbi: any[],
  contractAddress: string,
  eventName: string,
  eventSearchOptions: EventSearchOptions
): Promise<{ missingEvents: EventData[]; events: EventData[] }> {
  const allProviderEvents = await Promise.all(
    web3s.map((_web3) => {
      const _contract = new _web3.eth.Contract(contractAbi, contractAddress);
      return _contract.getPastEvents(eventName, eventSearchOptions);
    })
  );

  // Union map of ALL unique events across all providers: [{eventKey => {eventData, count}}]. We'll use this map to
  // keep track of how many times we see each event. For an event to be returned successfully from this method, it must
  // seen exactly once for each web3 provider.
  const uniqueEvents: { [uniqueEventKey: string]: { event: EventData; count: number } } = {};

  const _getUniqueEventKey = (event: EventData): string => {
    return JSON.stringify({
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      returnValues: event.returnValues,
      address: event.address,
    });
  };
  allProviderEvents.forEach((eventDataForProvider) => {
    eventDataForProvider.forEach((event) => {
      const uniqueEventKey = _getUniqueEventKey(event);
      // Add event to union map if we haven't seen it before.
      if (uniqueEvents[uniqueEventKey] === undefined) uniqueEvents[uniqueEventKey] = { event, count: 1 };
      else uniqueEvents[uniqueEventKey].count++;
    });
  });

  // Store only the events returned by ALL providers.
  const eventKeysReturnedByAllProviders: string[] = [];
  const missingEventKeys: string[] = [];
  Object.keys(uniqueEvents).forEach((eventKey: string) => {
    if (uniqueEvents[eventKey].count === web3s.length) eventKeysReturnedByAllProviders.push(eventKey);
    else missingEventKeys.push(eventKey);
  });

  return {
    missingEvents: missingEventKeys.map((eventKey) => uniqueEvents[eventKey].event),
    events: eventKeysReturnedByAllProviders.map((eventKey) => uniqueEvents[eventKey].event),
  };
}
