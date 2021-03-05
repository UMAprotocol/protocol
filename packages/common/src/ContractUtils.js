/**
 * This is a hack to handle reverts for view/pure functions that don't actually revert on public networks.
 * See https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211 for more
 * info.
 * @param {Object} result Return value from calling a contract's view-only method.
 * @return null if the call reverted or the view method's result.
 */
const revertWrapper = result => {
  if (!result) {
    return null;
  }
  let revertValue = "3963877391197344453575983046348115674221700746820753546331534351508065746944";
  if (result.toString() === revertValue) {
    return null;
  }
  const isObject = obj => {
    return obj === Object(obj);
  };
  if (isObject(result)) {
    // Iterate over the properties of the object and see if any match the revert value.
    for (let prop in result) {
      if (result[prop] && result[prop].toString() === revertValue) {
        return null;
      }
    }
  }
  return result;
};

/**
 * Simulate transaction via .call() and then .send() and return receipt. If an error is thrown,
 * return the error and add a flag denoting whether it was sent on the .call() or the .send().
 * @param {*Object} transaction Transaction to call `.call()` and subsequently `.send()` on from `senderAccount`.
 * @param {*Object} config transaction config, e.g. { gasPrice, from }, passed to web3 transaction.
 * @return Error and type of error (originating from `.call()` or `.send()`) or transaction receipt and return value.
 */
const runTransaction = async ({ transaction, config }) => {
  // First try to simulate transaction and also extract return value if its
  // a state-modifying transaction. If the function is state modifying, then successfully
  // sending it will return the transaction receipt, not the return value, so we grab it here.
  let returnValue, estimatedGas;
  try {
    [returnValue, estimatedGas] = await Promise.all([transaction.call(config), transaction.estimateGas(config)]);
  } catch (error) {
    error.type = "call";
    throw error;
  }

  // .call() succeeded, now broadcast transaction.
  let receipt;
  try {
    receipt = await transaction.send({ ...config, gas: estimatedGas });
    return {
      receipt,
      returnValue
    };
  } catch (error) {
    error.type = "send";
    throw error;
  }
};

module.exports = {
  revertWrapper,
  runTransaction
};
