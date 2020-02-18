## Voting Command Line Interface (CLI)
Simple to use command line interface for voting on price requests and retrieving rewards.

# Installation
1. Clone the UMA monorepo.
```sh 
git clone git@github.com:UMAprotocol/protocol.git
```
2. Install dependencies.
```sh
cd protocol && npm install
```
3. Symlink the CLI to your global directory. This will allow you to run the voting CLI by simply typing: `uma ...`.
```sh
npm link
```
4. Start the voting CLI by passing in the provider
```sh
uma --network <provider>
```

# Provider examples
Connect to your local development network with the first test account as your default account:
```sh
uma --network test
```

Connect to mainnet with the private key stored in the environment variable `PRIVATE_KEY`:
```sh
uma --network mainnet_privatekey
```

Connect to rinkeby with the mnemonic stored in the environment variable `MNEMONIC`. This will use the first account tied to the mnemonic as the signer account:
```sh
uma --network rinkeby_mnemonic
```

Connect to mainnet and vote with your two key contract, address stored in the environment variable `TWO_KEY_ADDRESS`, and the private key of the voter account stored in `PRIVATE_KEY`:
```sh
uma --network mainnet_privatekey
```

# Connecting your Ethereum Account
You have several methods for using the CLI tool with your Ethereum accounts
- Developers on localhost: If you are using [Ganache](https://github.com/trufflesuite/ganache) then pass in `--network test` to use the first account object that provided to you by Ganache. Note that you will have to deploy the contracts to your local network via `truffle migrate --reset network`.
- Private keys or Mnemonics of Hot Wallets containing UMA tokens: `--network <NETWORK>_privatekey` or `--network <NETWORK>_mnemonic_` will use the default account connected to the relevant environment variable: `PRIVATE_KEY` or `MNEMONIC`
- 2-Key Contract: If you are voting via a proxy contract, which we recommend as the most secure way to store ownership to your voting tokens in cold storage while conveniently being able to vote with the tokens via a hot wallet, then set your environment variable `TWO_KEY_ADDRESS` to the Ethereum address of your deployed 2-Key contract. For this to work correctly, the `PRIVATE_KEY` or `MNEMONIC` must be associated with the "voter" role of the 2-Key contract.

# Still needs to be tested:
- Metamask: starting the cli with `--network metamask` will correctly read your current Metamask account, but signing transactions does not work properly as the CLI tool appears to be unaware of when transactions are sent successfully by metakas