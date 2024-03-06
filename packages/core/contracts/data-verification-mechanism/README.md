# Deployments

Follow these instructions to deploy DVMv2 on a new L1 testnet. Note that mainnet deployments used their dedicated
upgrade scripts when migrating from DVMv1.

Cross chain setup between testnets is outside the scope of these instructions.

## Setup

Before running anything below, make sure you have run `yarn build` from the root of the repo.

Note that the fork network instructions can be used as a test run prior to the public network deployments.

## Starting a fork

To run a forked network deployment, run the following command:

```sh
HARDHAT_CHAIN_ID=<FORKED_CHAIN_ID> yarn hardhat node --fork <URL> --no-deploy --port <PORT>
```

You'll need to run two forks in separate terminals on different ports to do the deployments below.

Note: in the commands below, you'll need to set the relevant `NODE_URL_X` environment variable to the url of the locally
forked network `http://localhost:<PORT>`.

If you're having trouble redeploying contracts because `hardhat` wants to "reuse" contracts, then delete the associated
networks file under [packages/core/networks](/packages/core/networks) and run `yarn clean && yarn` in the `core`
package to reset `deployments`.

## Step-by-step guide to deployment on Sepolia testnet

The steps below explain how to deploy DVMv2 on Sepolia testnet.

1. Start by exporting some environment variables (or storing them in a .env):

```sh
# Set only the following environment variables based on which L1 testnet you're deploying to. For example, if you're
# deploying to Sepolia, set NODE_URL_11155111.
# When running against a forked network, set the URL to http://localhost:<PORT>
export NODE_URL_11155111=<TESTNET_URL>
export MNEMONIC="Your 12-word mnemonic here"
export ETHERSCAN_API_KEY="Your testnet Etherscan API key"
```

2. Add new network variables in `@uma/common` package:

- Hardhat `defaultConfig.networks` configuration in [packages/common/src/HardhatConfig.ts](/packages/common/src/HardhatConfig.ts).
- `etherscan.customChains` configuration in [packages/common/src/HardhatConfig.ts](/packages/common/src/HardhatConfig.ts)
  if the testnet is not supported by `@nomicfoundation/hardhat-verify` library (not required for Sepolia).
- `PublicNetworks` configuration in [packages/common/src/PublicNetworks.ts](/packages/common/src/PublicNetworks.ts)
- Default RPC to `getNodeUrl` in [packages/common/src/ProviderUtils.ts](/packages/common/src/ProviderUtils.ts) if the
  testnet is not supported by Infura (not required for Sepolia).
- Rebuild `@uma/common` package:

  ```sh
  cd packages/common
  yarn build
  ```

3. Deploy L1 testnet contracts:

```sh
# Replace --network parameter if deploying in other testnet than Sepolia.
yarn hardhat deploy --network sepolia --tags dvmv2,MockOracle
```

Add all the deployed contracts to the associated networks file under [packages/core/networks](/packages/core/networks).

4. Setup DVM contracts with Mock Oracle:

```sh
# Replace --network parameter if deploying in other testnet than Sepolia.
yarn hardhat setup-dvmv2-testnet --network sepolia --mockoracle
```

This would resolve price requests via mocked Oracle contract. If instead you need to resolve them via `VotingV2`, just
skip the `--mockoracle` flag.

5. Deploy and setup `OptimisticOracleV3` contract.

Before deploying `OptimisticOracleV3` first, approve its default price identifier and bonding currency, e.g.:

```sh
yarn hardhat whitelist-identifiers --network sepolia --id "ASSERT_TRUTH"
yarn hardhat whitelist-collateral --network sepolia --address 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
```

Now deploy `OptimisticOracleV3`:

```sh
# Replace --network parameter if deploying in other testnet than Sepolia.
yarn hardhat deploy --network sepolia --tags OptimisticOracleV3
```

Add the deployed `OptimisticOracleV3` contract to the associated networks file under [packages/core/networks](/packages/core/networks).

Also re-run DVM setup script from step 4 above, so that `OptimisticOracleV3` gets registered and synced:

```sh
yarn hardhat setup-dvmv2-testnet --network sepolia --mockoracle
```

6. Verify contracts:

```sh
# etherscan-verify does not work on Sepolia so we use hardhat verify on each deployed contract above.
yarn hardhat --network sepolia verify --contract <CONTRACT_FILE_PATH:CONTRACT_NAME> <EACH_DEPLOYED_ADDRESS> <ASSOCIATED_CONSTRUCTOR_PARAMS>
```

In case of more complex constructor arguments, pass them from file `--constructor-args arguments.js` as discussed in
[hardhat-verify docs](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify#complex-arguments).
In order to get constructor argument values, check them in `args` property from respective contract deployment json
file (appropriate network directory under `packages/core/deployments`).
