# Migration of Oracle request bridging contracts

This directory contains scripts to upgrade the Oracle request bridging contracts. Start with rebuilding the packages from the root of the repository:

```sh
yarn && yarn build
```

## Testing on forked networks

Spin up forked networks, each in a separate terminal, e.g.:

```sh
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy

HARDHAT_CHAIN_ID=137 yarn hardhat node --fork https://polygon-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9546 --no-deploy

HARDHAT_CHAIN_ID=10 yarn hardhat node --fork https://optimism-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9547 --no-deploy

HARDHAT_CHAIN_ID=42161 yarn hardhat node --fork https://arbitrum-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9548 --no-deploy

HARDHAT_CHAIN_ID=8453 yarn hardhat node --fork https://base-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9549 --no-deploy

HARDHAT_CHAIN_ID=81457 yarn hardhat node --fork https://blast-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9550 --no-deploy
```

Note that Ethereum mainnet must use port `9545` as some of the scripts rely on hardhat `localhost` network when forking. For other networks, you can use any other free port and pass its node URL as an environment variable.

Export the required environment for the mnemonic and all network node URLs:

```sh
export MNEMONIC=<YOUR-MNEMONIC>
export NODE_URL_1=http://localhost:9545
export NODE_URL_137=http://localhost:9546
export NODE_URL_10=http://localhost:9547
export NODE_URL_42161=http://localhost:9548
export NODE_URL_8453=http://localhost:9549
export NODE_URL_81457=http://localhost:9550
```

Note: make sure the wallet corresponding to the `MNEMONIC` is sufficiently funded on the forked networks (use `hardhat_setBalance` if needed).

Request to impersonate accounts and seed wallet on the forked mainnet that we'll need to propose and vote on admin proposals:

```sh
./packages/scripts/setupFork.sh
```

Redeploy the bridging contracts, this requires deleting the prior deployments.

```sh
rm packages/core/deployments/mainnet/OracleRootTunnel.json
yarn hardhat deploy --tags OracleRootTunnel --network mainnet
rm packages/core/deployments/matic/OracleChildTunnel.json
yarn hardhat deploy --tags OracleChildTunnel --network matic
rm packages/core/deployments/optimism/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network optimism
rm packages/core/deployments/arbitrum/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network arbitrum
rm packages/core/deployments/base/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network base
rm packages/core/deployments/blast/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network blast
```

Take note of all deployed contract addresses and update them under the corresponding network file in the `packages/core/networks` directory.

Rebuild the `contracts-node` package so that the new contract addresses are used in the scripts:

```sh
yarn workspace @uma/contracts-node build
```

Initialize Polygon tunnel contracts to point at each other:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/0_InitPolygonRootTunnels.ts --network localhost
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/1_InitPolygonChildTunnels.ts --network matic
```

Propose the governance vote to upgrade the Oracle request bridging contracts on the forked mainnet:

```sh
UMIP_NUMBER=185 yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/2_Propose.ts --network localhost
```

Simulate the vote on the proposal without executing it yet:

```sh
SKIP_EXECUTE=1 yarn hardhat run packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost
```

Execute the proposal on the forked mainnet and spoof relaying the governance transactions to forked L2 networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/3_Execute.ts --network localhost
```

Verify the proposal execution on the forked networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/4_Verify.ts --network localhost
```

## Upgrade on public networks

Update the required `NODE_URL_` environment variables to point to public networks.

Redeploy the bridging contracts, this requires deleting the prior deployments (same as in the forked network setup):

```sh
rm packages/core/deployments/mainnet/OracleRootTunnel.json
yarn hardhat deploy --tags OracleRootTunnel --network mainnet
rm packages/core/deployments/matic/OracleChildTunnel.json
yarn hardhat deploy --tags OracleChildTunnel --network matic
rm packages/core/deployments/optimism/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network optimism
rm packages/core/deployments/arbitrum/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network arbitrum
rm packages/core/deployments/base/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network base
rm packages/core/deployments/blast/OracleSpoke.json
yarn hardhat deploy --tags OracleSpoke --network blast
```

Take note of all deployed contract addresses and update them under the corresponding network file in the `packages/core/networks` directory.

Rebuild the `contracts-node` package so that the new contract addresses are used in the scripts:

```sh
yarn workspace @uma/contracts-node build
```

Initialize Polygon tunnel contracts to point at each other:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/0_InitPolygonRootTunnels.ts --network mainnet
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/1_InitPolygonChildTunnels.ts --network matic
```

Propose the governance vote to upgrade the Oracle request bridging contracts on the mainnet:

```sh
UMIP_NUMBER=185 GCKMS_WALLET=deployer yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/2_Propose.ts --network mainnet
```

Note: make sure to first authenticate to `gcloud`.

If the vote is resolved to approve the migration, execute the proposal on the mainnet and wait for it to be relayed to the L2 networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/3_Execute.ts --network mainnet
```

Verify the proposal execution on all the networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/4_Verify.ts --network mainnet
```
