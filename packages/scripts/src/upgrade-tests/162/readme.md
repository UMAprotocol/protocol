## UMIP 162 admin proposals

This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM in
the mainnet and layer 2 blockchains. It can be run on a local hardhat node fork of the mainnet or can be run
directly on the mainnet to execute the upgrade transactions.

1.Run a local forked node:

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
```

2.Run the simulation scripts:

Optional: Set up the fork by impersonating the required accounts.

```
./packages/scripts/setupFork.sh
```

2.1 Propose actions:
Run:

```
cd packages/scripts/
```

Then run:

```
OPTIMISTIC_ORACLE_V2_10=<OPTIMISM-OOV2-ADDRESS> \
NODE_URL_10=<OPTIMISM-NODE-URL> \
\
OPTIMISTIC_ORACLE_V2_288=<BOBA-OOV2-ADDRESS> \
NODE_URL_288=<OPTIMISM-NODE-URL> \
\
OPTIMISTIC_ORACLE_V2_137=<POLYGON-OOV2-ADDRESS> \
NODE_URL_137=<OPTIMISM-NODE-URL> \
\
OPTIMISTIC_ORACLE_V2_42161=<ARBITRUM-OOV2-ADDRESS> \
NODE_URL_42161=<OPTIMISM-NODE-URL> \
\
OPTIMISTC_ORACLE_V2=<MAINNET-OOV2-ADDRESS> \
\
yarn hardhat run ./src/upgrade-tests/162/1_Propose.ts  --network localhost
```

2.2 Simulate votes and execute proposals:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network mainnet-fork
```

2.3 Verify the result:

```
PROPOSAL_DATA=<PROPOSAL_DATA> yarn hardhat run ./src/upgrade-tests/162/2_Verify.ts --network localhost
```
