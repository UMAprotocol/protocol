export default class DrizzleHelper {
  constructor(drizzle) {
    this.drizzle = drizzle;
  }

  // addContract adds the specified address to drizzle.
  addContract(address, abi) {
    const drizzle = this.drizzle;

    return new Promise((resolve, reject) => {
      const contract = drizzle.contracts[address];
      if (contract) {
        resolve(contract);
      }

      drizzle.addContract({
        contractName: address,
        web3Contract: new drizzle.web3.eth.Contract(abi, address)
      });

      const unsubscribe = drizzle.store.subscribe(() => {
        const contract = drizzle.contracts[address];
        if (!contract) {
          return;
        }

        unsubscribe();
        resolve(contract);
      });
    });
  }

  // cacheCall requests data from the provider and returns a promise.
  // The promise resolves an object { address, methodName, key, result }
  // or rejects if the contract specified in `address` has not been added to drizzle.
  cacheCall(address, methodName, args) {
    const drizzle = this.drizzle;

    return new Promise((resolve, reject) => {
      const contract = drizzle.contracts[address];
      if (!contract) {
        reject(`contract ${address} does not exist`);
      }

      const key = contract.methods[methodName].cacheCall(...args);
      // TODO: Check the contract state here and immediately resolve if data exists and is fresh.

      const unsubscribe = drizzle.store.subscribe(() => {
        const contractState = drizzle.store.getState().contracts[address];
        if (!contractState) {
          return;
        }

        const result = contractState[methodName][key];
        if (!result) {
          return;
        }

        unsubscribe();
        resolve({ address, methodName, key, result: result.value });
      });
    });
  }

  // cacheCallAll accepts an array of objects { address, methodName, args }.
  // Returns a promsie with an array of objects { address, methodName, key, result }.
  // Rejects if any contract in `callArgs` has not been added to drizzle.
  cacheCallAll(callArgs) {
    const allPromises = callArgs.map(({ address, methodName, args }) => {
      return this.cacheCall(address, methodName, args);
    });

    return Promise.all(allPromises);
  }
}
