# Core peripheral scripts

This folder contains scripts that either fetch or modify state from the `core` UMA contracts.

## Before you start

Before starting, you will need to install dependencies and build the entire repository. You can do this by running the following command from the top level directory `protocol/`:

```sh
yarn && yarn build
```

If you run into any problems with the examples below, the first thing you should do is try clearing the local build artifacts and packages and reinstalling by running the following commands from the top level directory `protocol/`:

```sh
yarn clean-packages && rm -rf packages/core/artifacts packages/core/cache && yarn && yarn build
```

## Mainnet fork

The caller might find it useful to run these scripts against a local (hardhat) [Mainnet fork](https://hardhat.org/guides/mainnet-forking.html) in order to test that the contract state is modified as expected. The local node should be set to run on port `9545`.

Scripts can then be run as `node` scripts connected to the local node by passing in the `--network mainnet-fork` flag.

After the developer has tested against the local Mainnet fork, they can use the same script connected to a public network. Usually this would involve passing a network name like `mainnet_mnemonic` or `mainnet_gckms` to the `--network` flag to the script and other supporting flags like `--keys`.

## How to run

All scripts are designed to be framework-agnostic (i.e. not wed to `hardhat` or `truffle`) and run as `node` scripts.

For testing locally against a mainnet fork, we first might need to [impersonate accounts](https://hardhat.org/guides/mainnet-forking.html#impersonating-accounts) on the local fork. We can do so via the helper script `./setupFork.sh`. `setupFork.sh` should also run other fork node pre-test setup.

Test scripts can be run by passing in the `--network mainnet-fork` flag.

For running scripts in production, simply point the `--network` flag to a public network like `mainnet_gckms` like so: `node ... --network mainnet_gckms --keys deployer`.

## Example: starting a local fork of Ethereum Mainnet and impersonating accounts

1. Open a terminal window and start a mainnet fork node locally:

```sh
yarn hardhat node --fork https://mainnet.infura.io/v3/YOUR-INFURA-KEY --no-deploy --port 9545
```

2. Request to impersonate accounts we'll need to propose and vote on admin proposals:

```sh
./packages/scripts/setupFork.sh
```

3. Run your script against the local mainnet fork

```sh
node YOUR_FILE.js --network mainnet-fork
```

## Testing the Voter Dapp

Start a local hardhat node:

```sh
yarn hardhat node --no-deploy --port 9545
```

Run the base contract deployment:

```sh
yarn hardhat deploy --network localhost
```

Run the fixture script to set up the contracts:

```sh
HARDHAT_NETWORK=localhost ./src/utils/Deploy.js
```

To request a typical price (that you can vote on in the dapp):

```sh
HARDHAT_NETWORK=localhost ./src/local/RequestOraclePrice.js --identifier SOME_ID --time 1636667039
```

To trigger a sample governance vote (that you can vote on in the dapp):

```sh
HARDHAT_NETWORK=localhost ./src/mainnet/ProposeAdmin.js --prod
```

To move to the next phase of voting:

```sh
HARDHAT_NETWORK=localhost ./src/local/AdvanceToNextVotingPhase.js
```
