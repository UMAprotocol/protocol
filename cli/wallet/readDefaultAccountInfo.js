const style = require("../textStyle");
const getDefaultAccount = require("./getDefaultAccount");
const getTwoKeyContract = require("./getTwoKeyContract");
const { contractFromArtifact } = require("../../common/ContractUtils");

const VotingToken = require("@umaprotocol/core/build/contracts/VotingToken.json");

/**
 * Displays information about the default account:
 * - Address
 * - ETH balance
 * - UMA voting token balance
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} artifacts Contract artifacts
 */
const readDefaultAccountInfo = async web3 => {
  const { fromWei } = web3.utils;
  const { getBalance } = web3.eth;

  try {
    style.spinnerReadingContracts.start();
    const account = await getDefaultAccount(web3);
    const address = account;
    const balance = await getBalance(address);
    const votingToken = await contractFromArtifact(VotingToken, web3);
    const votingBalance = await votingToken.methods.balanceOf(address).call();
    let designatedVotingContract = await getTwoKeyContract(web3);
    style.spinnerReadingContracts.stop();

    console.group(style.success("\n** Ethereum Account Info **"));
    console.log(`- ${style.success("Address")}: ${address}`);
    console.log(`- ${style.success("Balance")}: ${fromWei(balance)} ETH`);
    console.log(`- ${style.success("Balance")}: ${fromWei(votingBalance)} UMA voting token`);
    console.log("\n");
    console.groupEnd();

    if (designatedVotingContract) {
      const designatedVotingBalanceEth = await getBalance(designatedVotingContract.options.address);
      const designatedVotingBalanceVoting = await votingToken.methods
        .balanceOf(designatedVotingContract.options.address)
        .call();

      console.group(style.success("\n** Two Key Contract Info **"));
      console.log(`- ${style.success("Address")}: ${designatedVotingContract.options.address}`);
      console.log(`- ${style.success("Balance")}: ${fromWei(designatedVotingBalanceEth)} ETH`);
      console.log(`- ${style.success("Balance")}: ${fromWei(designatedVotingBalanceVoting)} UMA voting token`);
      console.log("\n");
      console.groupEnd();
    }
  } catch (err) {
    console.error(err);
    console.error(
      "Failed to read default account information. Are you sure the contracts are deployed to this network?"
    );
  }
};

module.exports = readDefaultAccountInfo;
