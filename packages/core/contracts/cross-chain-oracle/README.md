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

You'll need to run two forks in separate terminals on different ports to do the deployments below.

Note: in the commands below, you'll need to replace your CUSTOM_NODE_URL with http://localhost:<PORT> to run against this local fork.

## Arbitrum

1. Start by exporting some environment variables (or storing them in a .env):

```sh
export NODE_URL_1=<MAINNET_URL>
export NODE_URL_42161=<ARBITRUM_URL>
export MNEMONIC="Your 12-word mnemonic here"
```

2. Deploy mainnet contracts:

```sh
yarn hardhat deploy --network mainnet --tags ArbitrumParentMessenger,OracleHub,GovernorHub
```

3. Deploy l2 contracts:

```sh
yarn hardhat deploy --network arbitrum --tags ArbitrumChildMessenger,OracleSpoke,GovernorSpoke
```

4. Setup mainnet contracts

```sh
yarn hardhat setup-l1-arbitrum-cross-chain --network mainnet
```

5. Setup l2 contracts

```sh
yarn hardhat setupL2ArbitrumCrossChain --network arbitrum
```
