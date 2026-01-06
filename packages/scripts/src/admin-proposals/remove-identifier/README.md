# Removal of supported identifier

This directory contains scripts to remove an identifier from the IdentifierWhitelist on all supported governance based networks.

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

Note that Ethereum mainnet must use port `9545` as the scripts rely on hardhat `localhost` network when forking. For other networks, you can use any other free port and pass its node URL as an environment variable.

Export the required environment:

```sh
export MNEMONIC=<YOUR-MNEMONIC>
export NODE_URL_137=http://localhost:9546
export NODE_URL_10=http://localhost:9547
export NODE_URL_42161=http://localhost:9548
export NODE_URL_8453=http://localhost:9549
export NODE_URL_81457=http://localhost:9550
export UMIP_NUMBER=<UMIP-NUMBER>
export IDENTIFIER=<IDENTIFIER-TO-REMOVE>
```

Note: make sure the wallet corresponding to the `MNEMONIC` is sufficiently funded on the forked networks (use `hardhat_setBalance` if needed).

Request to impersonate accounts and seed wallet on the forked mainnet that we'll need to propose and vote on the admin proposal:

```sh
./packages/scripts/setupFork.sh
```

Propose the governance vote to remove the supported identifier on the forked mainnet:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/0_Propose.ts --network localhost
```

Simulate the vote on the proposal without executing it yet:

```sh
SKIP_EXECUTE=1 yarn hardhat run packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost
```

Execute the proposal on the forked mainnet and spoof relaying the governance transactions to forked L2 networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/executeAndRelayVoteV2.ts --network localhost
```

Verify the proposal execution on the forked networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/1_Verify.ts --network localhost
```

## Public networks

Update the required `NODE_URL_` environment variables to point to public networks.

Propose the governance vote to remove the supported identifier on the mainnet:

```sh
GCKMS_WALLET=deployer yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/0_Propose.ts --network mainnet
```

Note: make sure to first authenticate to `gcloud`.

If the vote is resolved to approve the migration, execute the proposal on the mainnet and wait for it to be relayed to the L2 networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/executeAndRelayVoteV2.ts --network mainnet
```

Verify the proposal execution on all the networks:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/1_Verify.ts --network mainnet
```
