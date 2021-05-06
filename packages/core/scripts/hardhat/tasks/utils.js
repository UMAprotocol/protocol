const waitForTxn = promise => {
    return promise.then((tx) => tx.wait());
  }

module.exports = {
    waitForTxn
}