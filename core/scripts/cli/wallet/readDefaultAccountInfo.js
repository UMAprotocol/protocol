const style = require("../textStyle");
const getDefaultAccount = require("./getDefaultAccount");

module.exports = async web3 => {
  const { fromWei } = web3.utils;
  const { getBalance } = web3.eth;

  try {
    const account = await getDefaultAccount(web3);
    const address = account;
    let balance = await getBalance(address);
    console.group(style.bgRed(`\n** Ethereum Account Info **`));
    console.log(`- ${style.bgRed(`Address`)}: ${address}`);
    console.log(`- ${style.bgRed(`Balance`)}: ${fromWei(balance)} ETH`);
    console.log(`\n`);
    console.groupEnd();
  } catch (err) {
    console.log(`web3 instance does not have any accounts attached, use 'wallet init' to create a new account`);
  }
};
