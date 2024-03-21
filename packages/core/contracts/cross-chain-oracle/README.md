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

## Step-by-step guide to deployments on rollups: Arbitrum, Boba, Optimism and Base

The steps below explain how to deploy the cross-chain oracle onto supported rollups.

1. Start by exporting some environment variables (or storing them in a .env):

```sh
# Set only the following environment variables based on which L2 you're deploying to. For example, if you're deploying to mainnet and arbitrum, set NODE_URL_1 and NODE_URL_42161.
# When running against a forked network, set the URL to http://localhost:<PORT>
export NODE_URL_1=<MAINNET_URL>
export NODE_URL_42161=<ARBITRUM_URL>
export NODE_URL_288=<BOBA_URL>
export NODE_URL_10=<OPTIMISM_URL>
export NODE_URL_8453=<BASE_URL>
export MNEMONIC="Your 12-word mnemonic here"
```

2. Deploy mainnet contracts. Note that the following commands are slightly different based on which L2 you're deploying to.

```sh
yarn hardhat deploy --network mainnet --tags [l1-arbitrum-xchain/l1-boba-xchain/l1-optimism-xchain/l1-base-xchain]
```

Add the deployed [Arbitrum/Boba/Optimism/Base]\_ParentMessenger contract to the associated networks file.

3. Deploy l2 contracts:

```sh
yarn hardhat deploy --network [arbitrum/boba/optimism/base] --tags [l2-arbitrum-xchain/l2-boba-xchain/l2-optimism-xchain/l2-base-xchain],Registry

```

Add the deployed [Arbitrum/Boba/Optimism/Base] Registry, finder, OracleSpoke, GovernorSpoke and x_ChildMessenger contracts to the associated networks file.

4. Verify contracts:

```sh
# mainnet
yarn hardhat --network mainnet etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# arbitrum
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# boba
yarn hardhat --network boba sourcify
# Optimism (etherscan-verify does not work on Optimism so we use hardhat verify)
yarn hardhat --network optimism verify <EACH-DEPLOYED ADDRESS IN STEP 3> <ASSOCIATED CONSTRUCTOR PARAMS FROM 3>
# Base
yarn hardhat --network base verify <EACH-DEPLOYED ADDRESS IN STEP 3> <ASSOCIATED CONSTRUCTOR PARAMS FROM 3>
```

5. Setup mainnet contracts

```sh
yarn hardhat [setup-l1-arbitrum-xchain/setup-l1-boba-xchain/setup-l1-optimism-xchain/setup-l1-base-xchain] --network mainnet
```

6. Setup l2 contracts

```sh
yarn hardhat setup-l2-xchain --network [arbitrum/boba/optimism/base]
```

7. At this point, the cross chain contract suite setup is complete. We will now deploy the `OptimisticOracle,OptimisticOracleV2` and required contracts to the L2, the `OptimisticOracleV3` contract is deployed in a later step.

```sh
yarn hardhat deploy --network [arbitrum/boba/optimism/base] --tags OptimisticOracle,OptimisticOracleV2,OptimisticOracleV3,IdentifierWhitelist,AddressWhitelist,Store
```

8. Verify contracts:

```sh
# arbitrum
yarn hardhat --network arbitrum etherscan-verify --api-key <ETHERSCAN_KEY> --license GPL-3.0 --force-license
# boba
yarn hardhat --network boba sourcify
# Optimism (etherscan-verify does not work on Optimism so we use hardhat verify)
yarn hardhat --network optimism verify <EACH-DEPLOYED ADDRESS IN STEP 7> <ASSOCIATED CONSTRUCTOR PARAMS FROM 7>
# Base
yarn hardhat --network base verify <EACH-DEPLOYED ADDRESS IN STEP 7> <ASSOCIATED CONSTRUCTOR PARAMS FROM 7>
```

9. Setup l2 optimistic oracle:

```sh
# Seed IdentifierWhitelist with all identifiers already approved on mainnet. Note the --from address is the IdentifierWhitelist deployed on mainnet.
CROSS_CHAIN_NODE_URL=<MAINNET_URL> yarn hardhat migrate-identifiers --network [arbitrum/boba/optimism/base] --from 0xcF649d9Da4D1362C4DAEa67573430Bd6f945e570 --crosschain true

# Seed Collateral whitelist with all collaterals already approved on Mainnet. This will also pull the final fee from the L1 store and set it in the L2 Store.
yarn hardhat --network [arbitrum/boba/optimism/base]  migrate-collateral-whitelist --l1chainid 1 --l2chainid [42161/288/10/8453]

# Point L2 Finder to remaining Optimistic Oracle system contracts.
yarn hardhat setup-finder --oraclespoke --identifierwhitelist --addresswhitelist --optimisticoracle --optimisticoraclev2 --store --network [arbitrum/boba/optimism/base]
# Register OptimisticOracles as registered contract.
yarn hardhat register-accounts --network [arbitrum/boba/optimism/base] --account <OPTIMISTIC_ORACLE_ADDRESS>
yarn hardhat register-accounts --network [arbitrum/boba/optimism/base] --account <OPTIMISTIC_ORACLEV2_ADDRESS>
yarn hardhat register-accounts --network [arbitrum/boba/optimism/base] --account <OPTIMISTIC_ORACLEV3_ADDRESS>
```

10. At this point we can deploy the `OptimisticOracleV3` contract to the L2:

- First deploy the `OptimisticOracleV3` contract with the required constructor arguments.
- Then run again the `setup-finder` script to point the L2 Finder to the `OptimisticOracleV3` contract.
  - Run: `yarn hardhat setup-finder --optimisticoraclev3 --network [arbitrum/boba/optimism/base]`
- Finally, register the `OptimisticOracleV3` contract as a registered contract.
  - Run: `yarn hardhat register-accounts --network [arbitrum/boba/optimism/base] --account <OPTIMISTIC_ORACLE_V3_ADDRESS>`

11. Perform other set up when appropriate such as transferring ownership to the Governor and Governor spokes. Run the following script to check all required steps:

```sh
yarn hardhat verify-xchain --network mainnet --l2 [arbitrum/boba/optimism/base]
```

## L2->L1 Message passing and finalization

The cross-chain-oracle contracts send messages from L1<->L2 under different situations. L1->L2 transactions are auto finalized on all recipient chains currently supported by the cross-chain oracle. However, L2->L1 transactions are not auto finalized on L1 in most cases. For example, when sending transactions from Optimism or Arbitrum back to Ethereum L1 the transaction needs to be executed manually on L1 after the 7 day liveness. In other UMA infrastructure, such as Across, there is an automatic finalizer bot that that picks up L2->L1 token transfers and automatically finalizes them on L1. This kind of infrastructure has not yet been built out for the cross-chain-oracle and therefore will need to be done manually if the situation arrives. Both Optimism and Arbitrum provide their own sets of scripts to facilitate this:

To finalize **Arbitrum** transactions see the docs [here](https://github.com/OffchainLabs/arbitrum-tutorials/tree/master/packages/outbox-execute) on how to do this. Alternatively, Arbiscan provides a list of L2->L1 transactions and a UI for finalizing those that have passed liveness. This can also be used if you don't want to run the `outbox-execute` script. The relevant page can be found [here](https://arbiscan.io/txsExit).

To finalize **Optimism** transactions see the equivalent script [here](https://github.com/ethereum-optimism/optimism/blob/34e7450873548f65bf3160ca58eed2328907310a/packages/sdk/tasks/finalize-withdrawal.ts#L14). Optimism's Etherscan also provides a UI, similar to Arbitrum, which can be found [here](https://optimistic.etherscan.io/txsExit).

To finalize **Base** transactions see the equivalent script [here](https://github.com/ethereum-optimism/optimism/blob/develop/packages/message-relayer/src/exec/withdraw.ts). Base's Etherscan also provides a UI, similar to Optimism, which can be found [here](https://basescan.org/txsExit).

**Boba** at present auto-finalizes all L2->L1 transactions without any required user intervention.

## Step-by-step guide to deployments for Non-rollup chains

The steps below explain how to deploy the cross-chain oracle onto non-rollup chains using the `Admin_ChildMessenger`. This enables a multisig to act as the "messenger" thereby enabling the UMA Optimistic oracle to be deployed onto chains that do not have a supporting canonical bridge.

1. Start by exporting some environment variables (or storing them in a `.env`):

```sh
# Set only the following environment variables based on which L2 you're deploying to. For example, if you're deploying to xDAI, set NODE_URL_100.
# When running against a forked network, set the URL to http://localhost:<PORT>
export NODE_URL_100=<XDAI_URL>
export MNEMONIC="Your 12-word mnemonic here"
export ETHERSCAN_API_KEY="Your L2 Etherscan API key"
```

2. Add new network variables in `@uma/common` and `@uma/financial-templates-lib` packages:

- Hardhat `defaultConfig.networks` configuration in [packages/common/src/HardhatConfig.ts](/packages/common/src/HardhatConfig.ts). Adding `companionNetworks` parameter pointing to L1 mainnet is required for approved collateral migration task.
- `etherscan.customChains` configuration in [packages/common/src/HardhatConfig.ts](/packages/common/src/HardhatConfig.ts) if the L2 is not supported by `@nomicfoundation/hardhat-verify` library.
- `PublicNetworks` configuration in [packages/common/src/PublicNetworks.ts](/packages/common/src/PublicNetworks.ts)
- `averageBlockTimeSeconds` in [packages/common/src/TimeUtils.ts](/packages/common/src/TimeUtils.ts)
- Default RPC to `getNodeUrl` in [packages/common/src/ProviderUtils.ts](/packages/common/src/ProviderUtils.ts)
- Gas estimator settings to `MAPPING_BY_NETWORK` in [packages/financial-templates-lib/src/helpers/GasEstimator.ts](/packages/financial-templates-lib/src/helpers/GasEstimator.ts)
- Rebuild `@uma/common` package:

  ```sh
  cd packages/common
  yarn build
  ```

3. Deploy L2 Contracts:

```sh
# Replace <l2name> with network name added in Hardhat configuration from Step 2 above.
yarn hardhat deploy --network <l2name> --tags l2-admin-xchain,Registry
```

Add the deployed `Registry`, `Finder`, `OracleSpoke`, `GovernorSpoke` and `Admin_ChildMessenger` contracts to the associated networks file under [packages/core/networks](/packages/core/networks).

4. Setup L2 contracts:

```sh
yarn hardhat setup-l2-admin-xchain --network <l2name>
```

5. We will now deploy the `OptimisticOracle`, `OptimisticOracleV2` and required contracts to the L2.

```sh
yarn hardhat deploy --network <l2name> --tags OptimisticOracle,OptimisticOracleV2,IdentifierWhitelist,AddressWhitelist,Store
```

Add the deployed `OptimisticOracle`, `OptimisticOracleV2`, `IdentifierWhitelist`, `AddressWhitelist` and `Store` contracts to the associated networks file under [packages/core/networks](/packages/core/networks).

6. Setup L2 `OptimisticOracle` and `OptimisticOracleV2`:

```sh
# Seed IdentifierWhitelist with all identifiers already approved on mainnet. Note the --from address is the IdentifierWhitelist deployed on mainnet.
CROSS_CHAIN_NODE_URL=<MAINNET_URL> yarn hardhat migrate-identifiers --network <l2name> --from 0xcF649d9Da4D1362C4DAEa67573430Bd6f945e570 --crosschain true

# Seed Collateral whitelist with all collaterals already approved on mainnet. This will also pull the final fee from the L1 store and set it in the L2 Store.
# Replace <l2chainid> with L2 chainId value.
yarn hardhat --network <l2name>  migrate-collateral-whitelist --l1chainid 1 --l2chainid <l2chainid>

# Point L2 Finder to remaining Optimistic Oracle system contracts.
yarn hardhat setup-finder --oraclespoke --identifierwhitelist --addresswhitelist --optimisticoracle --optimisticoraclev2 --store --network <l2name>

# Register OptimisticOracle as registered contract (repeat for OptimisticOracleV2).
yarn hardhat register-accounts --network <l2name> --account <OPTIMISTIC_ORACLE_ADDRESS>
```

7. Deploy `OptimisticOracleV3` to the L2.

First, update `ADDRESSES_FOR_NETWORK` variable in `OptimisticOracleV3` deploy script [057_deploy_optimistic_oracle_V3.js](/packages/core/deploy/057_deploy_optimistic_oracle_V3.js) with `defaultCurrency` (e.g. USDC) for selected network.

Deploy `OptimisticOracleV3` instance:

```sh
yarn hardhat deploy --network <l2name> --tags OptimisticOracleV3
```

Add the deployed `OptimisticOracleV3` contract to the associated networks file under [packages/core/networks](/packages/core/networks).

8. Setup L2 `OptimisticOracleV3`:

```sh
# Point L2 Finder to remaining OptimisticOracleV3 contract.
yarn hardhat setup-finder --optimisticoraclev3 --network <l2name>

# Register OptimisticOracleV3 as registered contract.
yarn hardhat register-accounts --network <l2name> --account <OPTIMISTIC_ORACLE_V3_ADDRESS>
```

9. Verify contracts:

```sh
# Use hardhat verify on each deployed contract above.
yarn hardhat --network <l2name> verify --contract <CONTRACT_FILE_PATH:CONTRACT_NAME> <EACH_DEPLOYED_ADDRESS> <ASSOCIATED_CONSTRUCTOR_PARAMS>
```

In case of more complex constructor arguments, pass them from file `--constructor-args arguments.js` as discussed in [hardhat-verify docs](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify#complex-arguments). In order to get constructor argument values, check them in `args` property from respective contract deployment json file (appropriate network directory under `packages/core/deployments`).

10. Transfer ownership:

Transfer deployed contract ownership for each of `Registry`, `Store`, `IdentifierWhitelist`, `AddressWhitelist`, `Finder` and `OptimisticOracleV3` instances to `GovernorSpoke`:

```sh
yarn hardhat transfer-owner --network <l2name> --contract <CONTRACT_ADDRESS> --owner <GOVERNOR_SPOKE_ADDRESS>
```

Also transfer `Admin_ChildMessenger` contract ownership to multisig:

```sh
yarn hardhat transfer-owner --network <l2name> --contract <ADMIN_CHILD_MESSENGER_ADDRESS> --owner <MULTISIG_ADDRESS>
```

11. Run the following script to check all required steps:

```sh
yarn hardhat verify-admin-xchain --network <l2name>
```
