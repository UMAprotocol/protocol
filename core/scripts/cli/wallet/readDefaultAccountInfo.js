const style = require("../textStyle");
const getDefaultAccount = require("./getDefaultAccount");

/**
 * Displays information about the default account:
 * - Address
 * - ETH balance
 * - UMA voting token balance
 *
 * @param {*} web3 Web3 provider
 * @param {*} artifacts Contract artifacts
 */
const readDefaultAccountInfo = async (web3, artifacts) => {
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
    console.group(style.success(`\n** Ethereum Account Info **`));
    console.log(`- ${style.success(`Address`)}: ${address}`);
    console.log(`- ${style.success(`Balance`)}: ${fromWei(balance)} ETH`);
    console.log(`- ${style.success(`Balance`)}: ${fromWei(votingBalance)} UMA voting token`);
    console.log(`\n`);
    console.groupEnd();
  } catch (err) {
    console.error(
      `Failed to read default account information. Are you sure the contracts are deployed to this network?`
    );
  }
};

module.exports = readDefaultAccountInfo;
