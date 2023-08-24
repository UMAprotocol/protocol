Adds a new address to AddressWhitelist and sets a final fee in the Store for the corresponding address through a proposal in ProposerV2 and vote in VotingV2.

Console 1

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<KEY> --port 9545 --no-deploy
```

Console 2

```
./packages/scripts/setupFork.sh

ADDRESS=<ADDRESS> FINAL_FEE=<FINAL_FEE> UMIP_NUMBER=<UMIP_NUMBER> NODE_URL_1=<NODE_URL_1> yarn hardhat run ./packages/scripts/src/admin-proposals/add-address-whitelist/0_Propose.ts --network localhost

yarn hardhat run ./packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost

ADDRESS=<ADDRESS> FINAL_FEE=<FINAL_FEE> NODE_URL_1=<NODE_URL_1> yarn hardhat run ./packages/scripts/src/admin-proposals/add-address-whitelist/1_Verify.ts --network localhost
```
