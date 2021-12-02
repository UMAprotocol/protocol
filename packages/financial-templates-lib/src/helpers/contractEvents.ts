import { EventData } from "web3-eth-contract";
import Web3 from "web3";

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

  // Associate each event with a key uniquely identifying the event. We'll use this key in the next step to determine
  // which events were returned by all providers.
  type UniqueEventData = { [uniqueEventKey: string]: EventData };
  const uniqueEventsForProvider: UniqueEventData[] = [];
  // [index of web3Provider => {eventKey => event}]
  const uniqueEvents: UniqueEventData = {};
  // Union map of ALL unique events across all providers: [{eventKey => event}]. We'll use this map as the starting
  // point for all of the matched events that we'll return from this function.

  const _getUniqueEventKey = (event: EventData): string => {
    return JSON.stringify({
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      returnValues: event.returnValues,
      address: event.address,
    });
  };
  allProviderEvents.forEach((eventDataForProvider, i) => {
    uniqueEventsForProvider[i] = {};
    eventDataForProvider.forEach((event) => {
      const uniqueEventKey = _getUniqueEventKey(event);
      // Add event for this provider.
      uniqueEventsForProvider[i][uniqueEventKey] = event;
      // Add event to union map if we haven't seen it before.
      uniqueEvents[uniqueEventKey] = event;
    });
  });

  // Store only the events returned by ALL providers.
  const eventKeysReturnedByAllProviders: string[] = [];
  const missingEventKeys: string[] = [];
  Object.keys(uniqueEvents).forEach((eventKey: string) => {
    let eventFoundInAllProviders = true;
    for (let providerIndex = 1; providerIndex < uniqueEventsForProvider.length; providerIndex++) {
      if (uniqueEventsForProvider[providerIndex][eventKey] === undefined) {
        eventFoundInAllProviders = false;
        break;
      }
    }
    if (eventFoundInAllProviders) eventKeysReturnedByAllProviders.push(eventKey);
    else missingEventKeys.push(eventKey);
  });

  return {
    missingEvents: missingEventKeys.map((eventKey) => uniqueEventsForProvider[0][eventKey]),
    events: eventKeysReturnedByAllProviders.map((eventKey) => uniqueEventsForProvider[0][eventKey]),
  };
}
