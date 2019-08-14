import { useEffect, useMemo, useState } from "react";

import { createExpandedPromise } from "./ExpandedPromise.js";

export default drizzle => (contractName, eventName, eventOptionsFn, eventOptionsArgs) => {
  const [eventsPromise, setEventsPromise] = useState();
  const drizzleContract = drizzle.contracts[contractName];
  const contract = useMemo(() => new drizzle.web3.eth.Contract(drizzleContract.abi, drizzleContract.address), [
    drizzleContract
  ]);

  // TODO: figure out how to only trigger when a deep comparison of eventOptionsArgs returns false.
  useEffect(() => {
    let mounted = true;
    let listener;
    // Each time this useEffect runs, we want to create a new eventsPromise, which will trigger a rerender and
    // everything downstream to update.
    setEventsPromise(createExpandedPromise());

    Promise.all(eventOptionsArgs === undefined ? [] : eventOptionsArgs).then(eventOptionsArgsResolved => {
      let eventOptions = eventOptionsFn(...eventOptionsArgsResolved);
      contract.getPastEvents(eventName, eventOptions).then(
        pastEvents =>
          mounted &&
          setEventsPromise(eventsPromise => {
            // Just resolve the promise with the events.
            eventsPromise.resolve(pastEvents);
            return eventsPromise;
          })
      );

      listener = drizzleContract.events[eventName]({
        ...eventOptions,
        fromBlock: "latest"
      }).on("data", event =>
        setEventsPromise(eventsPromise => {
          // Create a new promise to return the union of old events an new events.
          let newPromise = createExpandedPromise();

          // When the previous promise resolves with a list of events, append the event onto the end and resolve the
          // new promise with it.
          eventsPromise.then(events => {
            newPromise.resolve([...events, event]);
          });

          // Return the new promise (end of the chain of promises) as the new state variable.
          return newPromise;
        })
      );
    });
    return () => {
      if (listener) {
        listener.unsubscribe();
      }
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractName, eventName, eventOptionsFn, eventOptionsArgs]);

  return eventsPromise;
};
