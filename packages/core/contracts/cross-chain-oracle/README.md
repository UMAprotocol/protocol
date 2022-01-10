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

## Step-by-step guide to deployments

1. Start by exporting some environment variables (or storing them in a .env):

```sh
# Set only the following environment variables based on which L2 you're deploying to. For example, if you're deploying to mainnet and arbitrum, set NODE_URL_1 and NODE_URL_42161.
# When running against a forked network, set the URL to http://localhost:<PORT>
export NODE_URL_1=<MAINNET_URL>
export NODE_URL_42161=<ARBITRUM_URL>
export NODE_URL_288=<BOBA_URL>
export NODE_URL_10=<OPTIMISM_URL>
export MNEMONIC="Your 12-word mnemonic here"
```

2. Deploy mainnet contracts. Note that the following commands are slightly different based on which L2 you're deploying to.

```sh
yarn hardhat deploy --network mainnet --tags [l1-arbitrum-xchain/l1-boba-xchain/l1-optimism-xchain]
```

Add the deployed [Arbitrum/Boba/Optimism]\_ParentMessenger contract to the associated networks file.

3. Deploy l2 contracts:

```sh
yarn hardhat deploy --network [arbitrum/boba/optimism] --tags [l2-arbitrum-xchain/l2-boba-xchain/l2-optimism-xchain],Registry

```

Add the deployed [Arbitrum/Boba/Optimism] Registry, finder, OracleSpoke, GovernorSpoke and x_ChildMessenger **contracts** to the associated networks file.

1. Verify contracts:

```sh
# mainnet
yarn hardhat --network mainnet etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# arbitrum
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# boba
yarn hardhat --network boba sourcify
#optimism (etherscan-verify does not work on Optimism so we use hardhat verify)
yarn hardhat --network optimism verify <EACH-DEPLOYED ADDRESS IN STEP 3> <ASSOCIATED CONSTRUCTOR PARAMS FROM 3>
```

5. Setup mainnet contracts

```sh
yarn hardhat [setup-l1-arbitrum-xchain/setup-l1-boba-xchain/setup-l1-optimism-xchain] --network mainnet
```

6. Setup l2 contracts

```sh
yarn hardhat setup-l2-xchain --network [arbitrum/boba/optimism]
```

7. At this point, the cross chain contract suite setup is complete. We will now deploy the `OptimisticOracle` and required contracts to the L2.

```sh
yarn hardhat deploy --network [arbitrum/boba/optimism] --tags OptimisticOracle,IdentifierWhitelist,AddressWhitelist,Store
```

8. Verify contracts:

```sh
# arbitrum
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# boba
yarn hardhat --network boba sourcify
#optimism (etherscan-verify does not work on **Optimism** so we use hardhat verify)
yarn hardhat --network optimism verify <EACH-DEPLOYED ADDRESS IN STEP 7> <ASSOCIATED CONSTRUCTOR PARAMS FROM 7>
```

9. Setup l2 optimistic oracle:

```sh
# Seed IdentifierWhitelist with all identifiers already approved on mainnet. Note the --from address is the IdentifierWhitelist deployed on mainnet.
CROSS_CHAIN_NODE_URL=<MAINNET_URL> yarn hardhat migrate-identifiers --network [arbitrum/boba] --from 0xcF649d9Da4D1362C4DAEa67573430Bd6f945e570 --crosschain true

# Seed Collateral whitelist with all collaterals already approved on Mainnet. This will also pull the final fee from the L1 store and set it in the L2 Store.
yarn hardhat --network [arbitrum/boba/optimism]  migrate-collateral-whitelist --l1chainid 1 --l2chainid [42161/288/10]

# Point L2 Finder to remaining Optimistic Oracle system contracts.
yarn hardhat setup-finder --oraclespoke --identifierwhitelist --addresswhitelist --optimisticoracle --store --network [arbitrum/boba]
# Register OptimisticOracle as registered contract.
yarn hardhat register-accounts --network [arbitrum/boba/optimism] --account <OPTIMISTIC_ORACLE_ADDRESS>
```

## L2->L1 Message passing and finalization

The cross-chain-oracle contracts send messages from L1<->L2 under different situations. L1->L2 transactions are auto finalized on all recipient chains currently supported by the cross-chain oracle. However, L2->L1 transactions are not auto finalized on L1 in most cases. For example, when sending transactions from Optimism or Arbitrum back to Ethereum L1 the transaction needs to be executed manually on L1 after the 7 day liveness. In other UMA infrastructure, such as Across, there is an automatic finalizer bot that that picks up L2->L1 token transfers and automatically finalizes them on L1. This kind of infrastructure has not yet been built out for the cross-chain-oracle and therefore will need to be done manually if the situation arrives. Both Optimism and Arbitrum provide their own sets of scripts to facilitate this:

To finalize **Arbitrum** transactions see the docs [here](https://github.com/OffchainLabs/arbitrum-tutorials/tree/master/packages/outbox-execute) on how to do this. Alternatively, Arbiscan provides a list of L2->L1 transactions and a UI for finalizing those that have passed liveness. This can also be used if you don't want to run the `outbox-execute` script. The relevant page can be found [here](https://arbiscan.io/txsExit).

To finalize **Optimism** transactions see the equivalent script [here](https://github.com/ethereum-optimism/optimism/blob/develop/packages/message-relayer/src/exec/withdraw.ts). Optimism's Etherscan also provides a UI, similar to Arbitrum, which can be found [here](https://optimistic.etherscan.io/txsExit).

**Boba** at present auto-finalizes all L2->L1 transactions without any required user intervention.
