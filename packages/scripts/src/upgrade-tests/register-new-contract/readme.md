## Register new contract proposals

This script generates and submits the transaction to register in the Registry and add to the Finder an arbitrary new contract in mainnet and layer 2 blockchains. It can be run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade transactions.

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
NODE_URL_10=<OPTIMISM-NODE-URL> \
NODE_URL_288=<BOBA-NODE-URL> \
NODE_URL_137=<POLYGON-NODE-URL> \
NODE_URL_42161=<ARBITRUM-NODE-URL> \
yarn hardhat run ./src/upgrade-tests/register-new-contract/1_Propose.ts --network localhost
```

2.2 Simulate votes and execute proposals:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network mainnet-fork
```

2.3 Verify the result:

2.3.1 Verify the result in mainnet:

```
PROPOSAL_DATA=<PROPOSAL_DATA> yarn hardhat run ./src/upgrade-tests/register-new-contract/2_Verify.ts --network localhost
```

2.3.2 Verify the result in layer 2 chains:

```
FORK_NETWORK=true \ => optional
NODE_URL_10=<OPTIMISM-NODE-URL> \
NODE_URL_288=<BOBA-NODE-URL> \
NODE_URL_137=<POLYGON-NODE-URL> \
NODE_URL_42161=<ARBITRUM-NODE-URL> \
PROPOSAL_DATA=<PROPOSAL_DATA> yarn hardhat run ./src/upgrade-tests/register-new-contract/3_VerifyRelays.ts --network localhost
```
