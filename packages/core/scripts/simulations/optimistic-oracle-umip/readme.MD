1.Run a local forked node:

```
npx hardhat node --fork https://mainnet.infura.io/v3/<INFURA_KEY> --port 9545
```

2.Build the contract types:

```
cd packages/core
yarn generate-contract-types
```

3.Run the simulation script:

```
yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/1_Propose.ts --network localhost
```
