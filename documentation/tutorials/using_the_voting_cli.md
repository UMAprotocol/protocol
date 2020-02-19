# Voting Command Line Interface (CLI)

We provide a user-friendly command line interface for voting on price requests and retrieving rewards.

# Setup

## Installation

Until the Voting CLI is [published as an npm package](https://docs.npmjs.com/cli/publish), the only way to run the CLI locally is to clone the repo and then symlink the CLI command to your global directory.

We assume that you have followed the [Prerequisites](./prerequisites.md) (cloned the monorepo and ran `npm install` from `protocol/`) and are in the root directory (i.e. `protocol/`).

1. Symlink the CLI to your global directory. This will allow you to run the voting CLI by simply typing: `uma ...`. The specific command that is run is listed in the `bin` property of the root `package.json`. A simple alternative to this step is to run `npm install -g ./` which installs the UMA monorepo to your global directory and implicitly symlinks the `uma` command globally.

```sh
npm link
```
OR
```sh
npm install -g ./
```

2. Start the voting CLI by passing in the provider

```sh
uma --network <provider>
```

## Provider examples

Connect to your local development network with the first test account as your default account:

```sh
uma --network test
```

Connect to mainnet with the private key stored in the environment variable `PRIVATE_KEY`:

```sh
uma --network mainnet_privatekey
```

Connect to testnet with the mnemonic stored in the environment variable `MNEMONIC`. This will use the first account tied to the mnemonic as the signer account:

```sh
uma --network kovan_mnemonic
```

Connect to mainnet and vote with your two key contract, address stored in the environment variable `TWO_KEY_ADDRESS`, and the private key of the voter account stored in `PRIVATE_KEY`:

```sh
uma --network mainnet_privatekey
```

## Connecting your Ethereum Account

You have several methods for using the CLI tool with your Ethereum accounts
- Developers on localhost: If you are using [Ganache](https://github.com/trufflesuite/ganache) then pass in `--network test` to use the first account object that provided to you by Ganache. Note that you will have to deploy the contracts to your local network via `truffle migrate --reset network`.
- Private keys or Mnemonics of Hot Wallets containing UMA tokens: `--network <NETWORK>_privatekey` or `--network <NETWORK>_mnemonic_` will use the default account connected to the relevant environment variable: `PRIVATE_KEY` or `MNEMONIC`
- 2-Key Contract: If you are voting via a proxy contract, which we recommend as the most secure way to store ownership to your voting tokens in cold storage while conveniently being able to vote with the tokens via a hot wallet, then set your environment variable `TWO_KEY_ADDRESS` to the Ethereum address of your deployed 2-Key contract. For this to work correctly, the `PRIVATE_KEY` or `MNEMONIC` must be associated with the "voter" role of the 2-Key contract.


# Using the CLI Tool

After starting the CLI tool, a menu will appear. There will always be options "help" (to print out a list of commands) and "exit/back" (quit the tool or go back to the previous menu). 

## Modules

Selecting these lead to further menus with relevant actions:
- *Wallet*: View token balances for default account, from which you can vote
- *Vote*: Commit and reveal votes, and retrieve rewards
- *Admin*: Vote on system administrator proposals


# Development

## Incomplete features:

- Metamask: starting the cli with `--network metamask` will correctly read your current Metamask account, but signing transactions does not work properly as the CLI tool appears to be unaware of when transactions are sent successfully by metakas