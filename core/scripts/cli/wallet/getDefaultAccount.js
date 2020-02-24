// Main method for getting default account, used to sign all transactions in the CLI!
const DEFAULT_ACCOUNT_INDEX = 0;

/**
 * Returns the default account that the Voting CLI will use to commit and reveal votes.
 * @param {* Object} web3 Web3 provider
 */
const getDefaultAccount = async web3 => {
  const accounts = await web3.eth.getAccounts();

  if (accounts.length === 0) {
    throw new Error("No accounts in web3.eth.accounts.wallet");
  } else {
    return accounts[DEFAULT_ACCOUNT_INDEX];
  }
};

module.exports = getDefaultAccount;
