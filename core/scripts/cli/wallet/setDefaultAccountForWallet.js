// Clear out wallet's old accounts and add new account
module.exports = (web3, defaultAccount) => {
  web3.eth.accounts.wallet.clear();
  web3.eth.accounts.wallet.add(defaultAccount.privateKey);
};
