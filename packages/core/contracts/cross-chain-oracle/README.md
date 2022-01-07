# Deployments

Follow these instructions to deploy two smart contract suites to an L2 that are secured by and can communicate with the core DVM contracts on L1:

- Cross chain contracts that relay messages between L1 and L2.
- Optimistic oracle contracts that allow external contracts to make price requests from L2 to L1.

## Setup

Before running anything below, make sure you have run `yarn build` from the root of the repo.

Note that the fork network instructions can be used as a test run prior to the public network
deployments.

## Starting a fork

To run a forked network deployment, run the following command:

```sh
HARDHAT_CHAIN_ID=<FORKED_CHAIN_ID> yarn hardhat node --fork <URL> --no-deploy --port <PORT>
```

You'll need to run two forks in separate terminals on different ports to do the deployments below.

Note: in the commands below, you'll need to set the relevant `NODE_URL_X` environment variable to the url of the locally forked network `http://localhost:<PORT>`.

If you're having trouble redeploying contracts because `hardhat` wants to "reuse" contracts, then run `yarn clean && yarn` in the `core` package to reset `deployments`.

## Arbitrum

1. Start by exporting some environment variables (or storing them in a .env):

```sh
# When running against a forked network, set the URL to http://localhost:<PORT>
export NODE_URL_1=<MAINNET_URL>
export NODE_URL_42161=<ARBITRUM_URL>
export MNEMONIC="Your 12-word mnemonic here"
```

2. Deploy mainnet contracts:

```sh
yarn hardhat deploy --network mainnet --tags l1-arbitrum-xchain
```

3. Deploy l2 contracts:

```sh
yarn hardhat deploy --network arbitrum --tags l2-arbitrum-xchain,Registry
```

4. Verify contracts:

```sh
# mainnet
yarn hardhat --network mainnet etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# arbitrum
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
```

5. Setup mainnet contracts

```sh
yarn hardhat setup-l1-arbitrum-cross-chain --network mainnet
```

6. Setup l2 contracts

```sh
yarn hardhat setup-l2-arbitrum-cross-chain --network arbitrum
```

7. At this point, the cross chain contract suite setup is complete. We will now deploy the `OptimisticOracle` and required contracts to the L2.

```sh
yarn hardhat deploy --network arbitrum --tags OptimisticOracle,IdentifierWhitelist,AddressWhitelist
```

8. Verify contracts:

```sh
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
```

9. Setup l2 optimistic oracle:

```sh
# Seed IdentifierWhitelist with all identifiers already approved on mainnet. Note the --from address is the IdentifierWhitelist deployed on mainnet.
CROSS_CHAIN_NODE_URL=<MAINNET_URL> yarn hardhat migrate-identifiers --network arbitrum --from 0xcF649d9Da4D1362C4DAEa67573430Bd6f945e570 --crosschain true
# Point L2 Finder to remaining Optimistic Oracle system contracts.
yarn hardhat setup-finder --identifierwhitelist --addresswhitelist --optimisticoracle --network arbitrum
```

10. There is no script at the moment that facilitates seeding the `AddressWhitelist` with approved collateral currencies, so be sure to manually whitelist tokens such as `WETH/ETH`, `USDC`, `UMA`, etc.

# L2->L1 Message passing and finalization

The cross-chain-oracle contracts send messages from L1<->L2 under different situations. L1->L2 transactions are auto finalized on all recipient chains currently supported by the cross-chain oracle. However, L2->L1 transactions are not auto finalized on L1 in most cases. For example, when sending transactions from Optimism or Arbitrum back to Ethereum L1 the transaction needs to be executed manually on L1 after the 7 day liveness. In other UMA infrastructure, such as Across, there is an automatic finalizer bot that that picks up L2->L1 token transfers and automatically finalizes them on L1. This kind of infrastructure has not yet been built out for the cross-chain-oracle and therefore will need to be done manually if the situation arrives. Both Optimism and Arbitrum provide their own sets of scripts to facilitate this:

To finalize **Arbitrum** transactions see their docs [here](https://github.com/OffchainLabs/arbitrum-tutorials/tree/master/packages/outbox-execute) on how to do this. Alternatively, Arbiscan provides a list of L2->L1 transactions and a UI for finalizing those that have passed liveness. This can also be used if you don't want to run the `outbox-execute` script. The relevant page can be found [here](https://arbiscan.io/txsExit).

To finalize **Optimism** transactions see the equivalent script [here](https://github.com/ethereum-optimism/optimism/blob/develop/packages/message-relayer/src/exec/withdraw.ts). Optimism's Etherscan also provides a UI, similar to Arbitrum, which can be found [here](https://optimistic.etherscan.io/txsExit).
