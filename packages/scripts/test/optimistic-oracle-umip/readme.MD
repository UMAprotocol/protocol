1.Run a local forked node:

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
```

2.Run the simulation scripts:

In a new terminal:

```
cd packages/scripts
```

2.1 Propose actions:

```
yarn hardhat run ./test/optimistic-oracle-umip/1_Propose.ts --network mainnet-fork
```

2.2 Simulate votes:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./packages/scripts/src/admin-proposals/simulateVote.js --network mainnet-fork
```

2.3 Execute proposal:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/executeProposal.js --network mainnet-fork --id <PROPOSAL-ID-FROM-2.2>
```

2.4 Verify the result:

```
yarn hardhat run ./test/optimistic-oracle-umip/3_Verify.ts --network mainnet-fork
```
