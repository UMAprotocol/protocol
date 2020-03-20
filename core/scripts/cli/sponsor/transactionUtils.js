const style = require("../textStyle");
const PublicNetworks = require("../../../../common/PublicNetworks");

const submitTransaction = async (web3, submitFn, message) => {
  const etherscanBaseUrl = PublicNetworks[web3.networkId]
    ? PublicNetworks[web3.networkId].etherscan
    : "https://fake-etherscan.com";

  console.log(message);
  style.spinnerWritingContracts.start();
  const { receipt } = await submitFn();
  style.spinnerWritingContracts.stop();
  const etherscanLink = etherscanBaseUrl + "/tx/" + receipt.transactionHash;
  console.log("Done! Etherscan link:", etherscanLink);
};

module.exports = {
  submitTransaction
};
