# Cross Chain Infrastructure

This folder contains contracts that are built on top of bridge protocols to enable UMA's Optimistic Oracle and
Governance contracts to send messages across EVM networks.

# Hub and Spoke Architecture

*Hub and *Spoke contracts are included that are respectively deployed on "Parent" and "Child" networks. As the Hub
and Spoke names imply, one Hub is designed to service many Spokes. For example, the `OracleHub` can broadcast price
resolutions from the DVM on mainnet to any number of `OracleSpoke` contracts on other EVM networks like Polygon,
Arbitrum, Optimism, and more. Similarly, the `GovernorHub` can be used by the DVM to send governance transactions to
any number of `GovernanceSpoke` contracts on other EVM networks.

Hub and Spoke contract implementations are network agnostic, but Messenger contracts are network-specific because
they are the contracts that actually send intra-network messages.

# Parent and Child Messengers

*Hub and *Spoke contracts communicate via a Parent-Child tunnel: a `ParentMessenger` contract is always deployed
to the network that the *Hub contract is deployed to, and the `ChildMessenger` contract is always deployed to the
*Spoke contract's network.

So, *Hub and *Spoke contracts have a "1-to-N" relationship, and each *Hub and *Spoke pairing has one `ParentMessenger`
and `ChildMessenger` contract deployed to the *Hub and *Spoke networks respectively.

Depending on the specific EVM networks that the *Hub and *Spoke contracts are deployed to, the implementations of the
Messenger contracts will differ. For example, sending messages between Mainnet and Arbitrum requires calling different
system contract interfaces than sending messages between Mainnet and Polygon does. This is why each network has its own
Messenger contract implementation in the `/chain-adapters` folder.

# Deployment

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

If you're having trouble redeploying contracts because `hardhat` wants to "reuse" contracts, then run `yarn` in the `core` package to reset `deployments`.

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

7. At this point, the minimum set up is complete and further integration tests can be executed. Additionally, an OptimisticOracle can now be deployed to Arbitrum that can communicate back to mainnet via the newly deployed contracts.
