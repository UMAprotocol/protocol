import { useDrizzleStatePromise } from ".";

export default drizzle => (contractNameOrNames, methodNameOrFunction, ...args) => {
  const isFunction = typeof methodNameOrFunction === "function";
  const drizzlePromise = useDrizzleStatePromise((drizzleState, resolvePromise, ...resolvedArgs) => {
    if (isFunction) {
      methodNameOrFunction(
        (contractName, methodName, ...cacheCallArgs) => {
          const instance = drizzle.contracts[contractName];
          const cacheKey = instance.methods[methodName].cacheCall(...cacheCallArgs);
          const cache = drizzleState.contracts[contractName][methodName][cacheKey];
          return cache && cache.value;
        },
        resolvePromise,
        ...resolvedArgs
      );
    } else {
      const instance = drizzle.contracts[contractNameOrNames];
      const cacheKey = instance.methods[methodNameOrFunction].cacheCall(...resolvedArgs);
      const cache = drizzleState.contracts[contractNameOrNames][methodNameOrFunction][cacheKey];
      if (cache) {
        resolvePromise(cache.value);
      }
    }
  }, args);
  return drizzlePromise;
};
