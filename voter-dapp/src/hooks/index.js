import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import createUseCacheCallPromise from "./create-use-cache-call";
import createUseCacheEventsPromise from "./create-use-cache-events";
import debounce from "debounce";
import deepEqual from "deep-equal";
import { createExpandedPromise, resolveOrReplaceExpandedPromise } from "./ExpandedPromise.js";

const Context = createContext();
export const useDrizzle = () => useContext(Context);

function argsEqual(args1, args2) {
  if (args1 === args2) {
    return true;
  }

  if (args1 === undefined || args2 === undefined || args1 === null || args2 === null) {
    return false;
  }

  if (args1.length !== args2.length) {
    return false;
  }

  for (let i = 0; i < args1.length; i++) {
    const arg1 = args1[i];
    const arg2 = args2[i];

    if (arg1 instanceof Promise || arg2 instanceof Promise) {
      // If either arg is a promise, they must be strictly equal because deepEqual thinks all unresolved promises are
      // equivalent.
      if (arg1 !== arg2) {
        return false;
      }
    } else {
      // If neither is a promise, we can run deep equal to determine their equivalence.
      if (!deepEqual(arg1, arg2)) {
        return false;
      }
    }
  }

  return true;
}

// Redux-like state selector.
// `mapState` should be a function that takes the state of the drizzle store and returns only the part you need.
// The component will only rerender if this part changes.
// `args` is just an escape hatch to make the state update immediately when certain arguments change. `useCacheCall` uses it.
// It's useful when your `mapState` function depends on certain arguments and you don't want to wait for a `drizzle` store update when they change.
export const useDrizzleStatePromise = (mapState, args) => {
  const { drizzle } = useDrizzle();

  // We keep a ref to `mapState` and always update it to avoid having a closure over it in the subscription that would make changes to it not have effect.
  const mapStateRef = useRef(mapState);
  mapStateRef.current = mapState;

  // Start args as null so they won't initially compare equal to undefined or any array the user provides.
  const argsRef = useRef(null);
  const argsPromiseRef = useRef();

  const [resultPromise, setResultPromise] = useState(createExpandedPromise());
  const setNewValueRef = useRef();
  setNewValueRef.current = useMemo(
    () => value => resolveOrReplaceExpandedPromise(value, resultPromise, setResultPromise),
    [resultPromise]
  );

  // TODO: consider moving this to a useEffect().
  if (!argsEqual(argsRef.current, args)) {
    // Update the args ref and reset the args promise ref.
    argsRef.current = args;
    argsPromiseRef.current = createExpandedPromise();

    // Each time the arguments change, create a new promise and trigger a rerender to update all downstream deps.
    setResultPromise(createExpandedPromise());
    Promise.all(args === undefined ? [] : args).then(resolvedArgs => {
      if (!argsEqual(argsRef.current, args)) {
        // If the promises resolve only after the args have already changed, short circuit.
        return;
      }

      mapStateRef.current(drizzle.store.getState(), setNewValueRef.current, ...resolvedArgs);

      // Forward the resolution of the Promise.all on to the argsPromiseRef.
      argsPromiseRef.current.resolve(resolvedArgs);
    });
  }

  useEffect(() => {
    // Debounce udpates, because sometimes the store will fire too much when there are a lot of `cacheCall`s and the cache is empty.
    const debouncedHandler = debounce(() => {
      if (!argsPromiseRef.current.isResolved) {
        // Short circuit if it's not resolved - it will automatically update when the promise resolves.
        return;
      }

      argsPromiseRef.current.then(resolvedArgs => {
        // Should be called immediately since the promuse is resolved.
        mapStateRef.current(drizzle.store.getState(), setNewValueRef.current, ...resolvedArgs);
      });
    });

    const unsubscribe = drizzle.store.subscribe(debouncedHandler);
    return () => {
      unsubscribe();
      debouncedHandler.clear();
    };
  }, [drizzle.store]);
  return resultPromise;
};

export const DrizzleProvider = ({ children, drizzle }) => {
  const useCacheCallPromise = useMemo(() => createUseCacheCallPromise(drizzle), [drizzle]);
  const useCacheEventsPromise = useMemo(() => createUseCacheEventsPromise(drizzle), [drizzle]);
  return (
    <Context.Provider
      value={useMemo(
        () => ({
          drizzle,
          useCacheCallPromise,
          useCacheEventsPromise
        }),
        [drizzle, useCacheCallPromise, useCacheEventsPromise]
      )}
    >
      {children}
    </Context.Provider>
  );
};

DrizzleProvider.propTypes = {
  children: PropTypes.node.isRequired,
  drizzle: PropTypes.shape({}).isRequired
};

export * from "./components";
