const style = require("../textStyle");
const getDefaultAccount = require("./getDefaultAccount");

module.exports = async (web3, artifacts) => {
  const { fromWei } = web3.utils;
  const { getBalance } = web3.eth;
  const VotingToken = artifacts.require("VotingToken");

  try {
    style.spinnerReadingContracts.start();
    const account = await getDefaultAccount(web3);
    const address = account;
    const balance = await getBalance(address);
    const votingToken = await VotingToken.deployed();
    const votingBalance = await votingToken.balanceOf(address);
    style.spinnerReadingContracts.stop();
    console.group(style.bgRed(`\n** Ethereum Account Info **`));
    console.log(`- ${style.bgRed(`Address`)}: ${address}`);
    console.log(`- ${style.bgRed(`Balance`)}: ${fromWei(balance)} ETH`);
    console.log(`- ${style.bgRed(`Balance`)}: ${fromWei(votingBalance)} UMA voting token`);
    console.log(`\n`);
    console.groupEnd();
  } catch (err) {
    console.error(`Failed to read default account information:`,err)
  }
};
