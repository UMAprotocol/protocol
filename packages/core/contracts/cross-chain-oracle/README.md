# Deployments

## Setup

Before running anything below, make sure you have run `yarn build` from the root of the repo.

Note that the fork network instructions should be used as a test run prior to the public network
deployments.

## Starting a fork

To run a forked network deployment, run the following command:

```sh
HARDHAT_CHAIN_ID=<FORKED_CHAIN_ID> yarn hardhat node --fork <URL> --no-deploy --port 9545
```

Note: in the commands below, you'll need to replace your CUSTOM_NODE_URL with http://localhost:9545 to run against this local fork.

## Arbitrum

1. Deploy mainnet contracts:

```sh
CUSTOM_NODE_URL=<URL> yarn hardhat deploy --network arbitrum --tags ArbitrumParentMessenger,OracleHub,GovernorHub
```

2. Deploy l2 contracts:

```sh
CUSTOM_NODE_URL=<URL> yarn hardhat deploy --network arbitrum --tags ArbitrumChildMessenger,OracleSpoke,GovernorSpoke
```

3. Setup mainnet contracts

```sh
CUSTOM_NODE_URL=<URL> yarn hardhat setup-l1-arbitrum-cross-chain --network mainnet
```

3. Setup l2 contracts

```sh
CUSTOM_NODE_URL=<URL> yarn hardhat setupL2ArbitrumCrossChain --network arbitrum
```
