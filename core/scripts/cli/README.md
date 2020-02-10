# Connecting your Ethereum Account
You have several methods for using the CLI tool with your Ethereum accounts
- Developers on localhost: If you are using [Ganache](https://github.com/trufflesuite/ganache) then pass in `--network test` to use the first account object that provided to you by Ganache. Note that you will have to deploy the contracts to your local network via `truffle migrate --reset network`.
- Private keys or Mnemonics of Hot Wallets containing UMA tokens: `--network <NETWORK>_privatekey` or `--network <NETWORK>_mnemonic_` will use the default account connected to the relevant environment variable: `PRIVATE_KEY` or `MNEMONIC`
- 2-Key Contract: If you are voting via a proxy contract, which we recommend as the most secure way to store ownership to your voting tokens in cold storage while conveniently being able to vote with the tokens via a hot wallet, then set your environment variable `TWO_KEY_ADDRESS` to the Ethereum address of your deployed 2-Key contract. For this to work correctly, the `PRIVATE_KEY` or `MNEMONIC` must be associated with the "voter" role of the 2-Key contract.

# Still needs to be tested:
- Metamask: starting the cli with `--network metamask` will correctly read your current Metamask account, but signing transactions does not work properly as the CLI tool appears to be unaware of when transactions are sent successfully by metakas