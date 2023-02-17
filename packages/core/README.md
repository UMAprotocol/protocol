# @uma/core

This package contains contract artifacts for all UMA smart contracts. It contains the following sets of smart contracts within the `contracts` directory:

| **Directory Name**            | **Description**                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`                      | Common contracts re-used between diffrent contract implementations within this repo.                                                                                                                                                                                            |
| `cross-chain-oracle`          | Contracts to enable the UMA DVM to reach a number of side-chains & rollups.                                                                                                                                                                                                     |
| `data-verification-mechanism` | Schelling point commit reveal oracle used to arbitrate disputes in downstream escalation games.                                                                                                                                                                                 |
| `external`                    | External integration points from projects integrated into UMA core contracts.                                                                                                                                                                                                   |
| `finanical-templates`         | Financial contracts built on top of UMA's Oracle. Include Synthetic tokens (fixed term and perpetual), Long-short-pair(on-chain contract for diffrence) and a number of other mechanisms used to build on-chain incentive systems.                                              |
| `gnosis-zodiac`               | Gnosis Safe Zodiac integration enabling an Optimistic Oracle powered multisig deployments.                                                                                                                                                                                      |
| `merkle-distributor`          | Contracts enabling token distribution via merkle distribution and claim process.                                                                                                                                                                                                |
| `optimistic-oracle-v2`        | Optimistic oracle mechanism, used to bring data on-chain. Highly suited for complex, longtailed, time insensitive data such as prediction markets, insurance products and complex cross-chain applications.                                                                     |
| `optimistic-oracle-v3`        | Next iteration of optimistic oracle pattern wherein assertions are about the state of the world which are optimistically verified. Uses "sovereign security" to enable bespoke security models and design patterns over what is possible with other optimistic oracle designs.. |
| `polygon-cross-chain-oracle`  | Similar to `cross-chain-oracle` contracts, except just supports polygon. Kept for legacy reasons.                                                                                                                                                                               |
| `proxy-scripts`               | "Script" smart contracts, used in conjunction with DSProxy based actors.                                                                                                                                                                                                        |
| `umip-helpers`                | Smart contracts used in UMIPs, such as upgrading the DVM.                                                                                                                                                                                                                       |

## Installing the package

Note: this package should rarely be installed by third parties. For abi, bytecode, and official addresses, please use
the `@uma/contracts-node` or `@uma/contracts-frontend` packages.

This package should be primarily used to access the full contract source code where necessary. The contracts are
available in `contracts/`. If you need direct access to the hardhat artifacts, they are available under `artifacts/`.

```bash
yarn add @uma/core
```

## Deploying the contracts

To deploy the contracts, we use the `hardhat-deploy` package. This may be familiar to users of `hardhat`. The deployment
process is faily simple, as a result.

To deploy the entire UMA system on a network of your choice:

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat deploy --network kovan
```

To deploy a particular contract (along with any dependencies that haven't been deployed on this network):

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat deploy --network kovan --tags LongShortPairCreator
```

Note: other tags, like `dvm`, exist to deploy subsets of contracts.

To perform an etherscan verification on a particular contract address that you have deployed on a public network:

```sh
export ETHERSCAN_API_KEY="Your etherscan api key here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat verify "Your contract address here" --network kovan
```

To perform a verification on all the contracts you have deployed on a particular network:

```sh
export CUSTOM_NODE_URL="Your node url here"
export ETHERSCAN_API_KEY="Your etherscan api key here"
yarn hardhat etherscan-verify --network kovan --license AGPL-3.0 --force-license
```

To add a contract to the official UMA deployments, find the `networks/[chainId].json` file, and update an existing
contract entry or add a new one.

The following commands are implemented as [hardhat tasks](https://hardhat.org/guides/create-task.html) that make it easy to interact with deployed contracts via the CLI:

Registers the `deployer` account (as defined in the `namedAccounts` param in `hardhat.config.js`) with the deployed Registry for the network. Optionally registers a custom account.

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat register-accounts --network <NETWORK-NAME> --account <CUSTOM-ACCOUNT>
```

Whitelist hardcoded identifiers from the `config/identifiers.json` file. Optionally whitelists a custom identifier.

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat whitelist-identifiers --network <NETWORK-NAME> --id <CUSTOM-IDENTIFIER>
```

Sets specified contracts in the deployed Finder. More contracts available to be set can be found in the `common/hardhat/tasks/finder.js` script.

```sh
export MNEMONIC="Your 12-word phrase here"
export CUSTOM_NODE_URL="Your node url here"
yarn hardhat setup-finder --network <NETWORK-NAME> --registry --bridge --generichandler
```

## Integration tests

Some contracts, such as the Insured bridge, contain end to end integration tests that are run differently to the rest of
core's tests. Running these specific tests can be done as follows:

```bash
cd ../.. # navigate to the root of the protocol repo
yarn optimism-up # start the optimism containers. note this will take a long time as a few containers need to be built
cd ./packages/core # move back to this package
yarn test-e2e # run the end to end tests against the optimism containers.
```
