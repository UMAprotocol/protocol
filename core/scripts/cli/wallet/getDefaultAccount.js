// Main method for getting default account, used to sign all transactions in the CLI!
const DEFAULT_ACCOUNT_INDEX = 0;

module.exports = web3 => {
  const accounts = web3.eth.accounts.wallet;

  if (accounts.length === 0) {
    throw new Error(`No accounts in web3.eth.accounts.wallet`);
  } else if (accounts.length > 1) {
    console.warn(
      `There are ${accounts.length} accounts in the wallet, but there should only be 1. Using index ${DEFAULT_ACCOUNT_INDEX} as the default account.`
    );
    return accounts[DEFAULT_ACCOUNT_INDEX];
  } else {
    return accounts[DEFAULT_ACCOUNT_INDEX];
  }
};
