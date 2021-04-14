const ynatm = require("@umaprotocol/ynatm");

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
 * @notice Uses the ynatm package to retry the transaction with increasing gas price.
 * @param {*Object} transaction Transaction to call `.call()` and subsequently `.send()` on from `senderAccount`.
 * @param {*Object} config transaction config, e.g. { gasPrice, from }, passed to web3 transaction.
 * @return Error and type of error (originating from `.call()` or `.send()`) or transaction receipt and return value.
 */
const runTransaction = async ({ transaction, config }) => {
  // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
  const GAS_LIMIT_BUFFER = 1.25;

  // First try to simulate transaction and also extract return value if its
  // a state-modifying transaction. If the function is state modifying, then successfully
  // sending it will return the transaction receipt, not the return value, so we grab it here.
  let returnValue, estimatedGas;
  try {
    [returnValue, estimatedGas] = await Promise.all([
      transaction.call({ from: config.from }),
      transaction.estimateGas({ from: config.from })
    ]);
  } catch (error) {
    error.type = "call";
    throw error;
  }

  // .call() succeeded, now broadcast transaction.
  let receipt;
  try {
    let updatedConfig = {
      ...config,
      gas: Math.floor(estimatedGas * GAS_LIMIT_BUFFER)
    };
    // If config has a `nonce` field, then we will use the `ynatm` package to strategically re broadcast the
    // transaction. If the `nonce` is missing, then we'll send the transaction once.
    if (config.nonce) {
      // ynatm config:
      // - Doubles gasPrice every retry.
      const gasPriceScalingFunction = ynatm.DOUBLES;
      // - Tries every minute (and increases gas price according to `gasPriceScalingFunction`) if tx hasn't gone through.
      const retryDelay = 60000;
      // - Min Gas Price starts at caller's provided config.gasPrice, with a max gasPrice of x4
      const minGasPrice = updatedConfig.gasPrice;
      const maxGasPrice = 2 * 3 * minGasPrice;

      receipt = await ynatm.send({
        sendTransactionFunction: gasPrice =>
          transaction.send({
            ...updatedConfig,
            gasPrice
          }),
        minGasPrice,
        maxGasPrice,
        gasPriceScalingFunction,
        delay: retryDelay
      });
    } else {
      receipt = await transaction.send(updatedConfig);
    }
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
