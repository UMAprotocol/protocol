const style = require("../textStyle");
const { PublicNetworks } = require("@uma/common");

const submitTransaction = async (web3, submitFn, message, transactionNum, totalTransactions) => {
  const networkId = await web3.eth.net.getId();
  const etherscanBaseUrl = PublicNetworks[networkId]
    ? PublicNetworks[networkId].etherscan
    : "https://fake-etherscan.com/";

  if (totalTransactions > 1) {
    console.log(`(${transactionNum}/${totalTransactions}) ${message}`);
  } else {
    console.log(message);
  }
  style.spinnerWritingContracts.start();
  const { receipt } = await submitFn();
  style.spinnerWritingContracts.stop();
  const etherscanLink = `${etherscanBaseUrl}tx/${receipt.transactionHash}`;
  console.log(`Transaction submitted. Transaction link: ${etherscanLink}`);
};

module.exports = {
  submitTransaction
};
