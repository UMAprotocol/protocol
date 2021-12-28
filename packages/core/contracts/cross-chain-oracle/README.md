### Deployments

Note that the "-fork" network instructions should be used as a test run prior to the non "-fork" public network
deployments. To run a forked network deployment, run `yarn hardhat node --fork <URL> --no-deploy --port 9545` prior
to running the commands and then run the commands with `--network localhost` network.

# Arbitrum

1. Deploy mainnet contracts:

```sh
yarn hardhat deploy --network arbitrum --tags ArbitrumParentMessenger,OracleHub,GovernorHub
```

2. Deploy l2 contracts:

```sh
yarn hardhat deploy --network arbitrum --tags ArbitrumChildMessenger,OracleSpoke,GovernorSpoke
```

3. Setup mainnet contracts

```sh
yarn hardhat setup-l1-arbitrum-cross-chain --network mainnet
```

3. Setup l2 contracts

```sh
yarn hardhat setupL2ArbitrumCrossChain --network arbitrum
```
