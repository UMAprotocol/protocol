module.exports = async (web3) => {
    const { fromWei } = web3.utils;
    const { getBalance } = web3.eth;
  
    const accounts = web3.eth.accounts.wallet;
    if (accounts.length > 0) {
        // Latest added account is pushed to end of wallet
        const address = accounts[accounts.length-1].address;
        let balance = await getBalance(address);
        console.group(`\n** Ethereum Account Info **`);
        console.log(`- Address: ${address}`);
        console.log(`- Balance: ${fromWei(balance)} ETH`);
        console.groupEnd();
    } else {
        console.log(`web3 instance does not have any accounts attached, use 'wallet init' to create a new account`);
    }
}