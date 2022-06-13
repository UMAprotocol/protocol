1.Run a local forked node:

```
npx hardhat node --fork https://mainnet.infura.io/v3/d0d5d84b4f1f40079b76b63220ef8926 --port 9545
```

2.Build the contract types:

```
cd packages/core
yarn generate-contract-types
```

3.Run the simulation script:

```
yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/1_Propose.ts --network localhost
yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/2_VoteSimulate.ts --network localhost
yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/3_Verify.ts --network localhost
```
