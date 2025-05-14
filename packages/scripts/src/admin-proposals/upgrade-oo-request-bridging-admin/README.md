# Migration of Oracle request bridging contracts on admin chains

This directory contains scripts to upgrade the Oracle request bridging contracts on admin controlled chains. Start with rebuilding the packages from the root of the repository:

```sh
yarn && yarn build
```

## Testing on forked networks

Spin up the forked network in a separate terminal, e.g. for Story network:

```sh
HARDHAT_CHAIN_ID=1514 yarn hardhat node --fork <YOUR-STORY-RPC_URL> --port 9545 --no-deploy
```

Export the required environment for the mnemonic and network node URL, e.g. for Story:

```sh
export MNEMONIC=<YOUR-MNEMONIC>
export NODE_URL_1514=http://localhost:9545
```

Note: make sure the wallet corresponding to the `MNEMONIC` is sufficiently funded on the forked networks (use `hardhat_setBalance` if needed).

Redeploy the bridging contract, this requires deleting the prior deployment, e.g. for Story:

```sh
rm packages/core/deployments/story/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network story
```

Take note of the deployed OracleSpoke address and update it under the corresponding network file in the `packages/core/networks` directory.

Rebuild the `contracts-node` package so that the new contract addresses are used in the scripts:

```sh
yarn workspace @uma/contracts-node build
```

Prepare and simulate the execution of the governance payload to upgrade the Oracle request bridging contract on the forked network:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/0_PayloadAdminChain.ts --network localhost
```

Verify the proposal execution on the forked network:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/1_Verify.ts --network localhost
```

## Upgrade on public networks

Update the required `NODE_URL_` environment variable to point to public network.

Redeploy the bridging contract, this requires deleting the prior deployments (same as in the forked network setup), e.g. for Story:

```sh
rm packages/core/deployments/story/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network story
```

Take note of the deployed OracleSpoke address and update it under the corresponding network file in the `packages/core/networks` directory.

Rebuild the `contracts-node` package so that the new contract addresses are used in the scripts:

```sh
yarn workspace @uma/contracts-node build
```

Prepare the governance payload to upgrade the Oracle request bridging contract on the public network, e.g. for Story:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/0_PayloadAdminChain.ts --network story
```

This should generate a JSON file under `packages/scripts/out` with the payload for the governance action. Upload it to the Safe transaction builder, sign and execute it by the required signers.

Verify the proposal execution on the public network, e.g. for Story:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/1_Verify.ts --network story
```
