# Voting With UMA Tokens

We provide a user-friendly command line interface for voting on price requests and retrieving rewards.

# Installation

We will walk you through setting up the CLI by first cloning the repo and then symlink-ing the CLI command to your global directory.

We assume that you have followed the [Prerequisites](../../synthetic_tokens/tutorials/prerequisites.md) (cloned the monorepo and installed dependencies for the root directory via `npm install`) and are in the root directory (i.e. `protocol`).

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

# Providers

We strongly recommend using a non-Metamask provider and prefer the "NETWORK_privatekey" option. For more on the specific issues that using a Metamask provider opens, see [Known Bugs](#known-bugs). Storing a private key in an environment variable is a safe compromise between convenience and security provided your local machine is not compromised. To set an environment variable, run:

```sh
export ENV_VARIABLE_NAME="VALUE"
```

To unset an environment variable, run:

```sh
unset ENV_VARIABLE_NAME
```

And to print out your environment variables, run:

```sh
printenv
```

Here are the various providers you can use:

- Connect to your local development network with the first test account as your default account. This would be useful for developers using [Ganache](https://github.com/trufflesuite/ganache). Note that you will first have to deploy the contracts to your local network via `truffle migrate --reset network`:

```sh
uma --network test
```

- Connect to mainnet with the private key stored in the environment variable `PRIVATE_KEY`:

```sh
uma --network mainnet_privatekey
```

- Connect to testnet with the mnemonic stored in the environment variable `MNEMONIC`. This will use the first account tied to the mnemonic as the signer account:

```sh
uma --network kovan_mnemonic
```

- Connect to mainnet and vote with your two key contract, address stored in the environment variable `TWO_KEY_ADDRESS`, and the private key of the voter account stored in `PRIVATE_KEY`. We recommend this method as the most secure way to store ownership to your voting tokens in cold storage while conveniently being able to vote with the tokens via a hot wallet:

```sh
uma --network mainnet_privatekey
```

- Connect with your Metamask provider:

```sh
uma --network metamask
```

# Features

After starting the CLI tool, a menu will appear. There will always be options "help" (to print out a list of commands) and "exit/back" (quit the tool or go back to the previous menu).

## Modules

Selecting these lead to further menus with relevant actions:

- _Wallet_: View token balances for default account, from which you can vote
- _Vote_: Commit and reveal votes, retrieve rewards, and view results of previous votes.
- _Admin_: Vote on system administrator proposals

# Known Bugs:

- Metamask: retrieving rewards and viewing past vote results does not work well with the Metamask provider, specifically because it does not do a great job of reading past event logs. To read more technical details about the issue, go [here](https://github.com/UMAprotocol/protocol/issues/901).
