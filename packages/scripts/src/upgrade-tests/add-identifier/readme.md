How to test this scripts:

Console 1

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<KEY> --port 9545 --no-deploy
```

Console 2

```
./packages/scripts/setupFork.sh

IDENTIFIER=<IDENTIFIER> UMIP_NUMBER=<UMIP_NUMBER> yarn hardhat run ./packages/scripts/src/upgrade-tests/add-identifier/0_Propose.ts --network localhost

yarn hardhat run ./packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost

IDENTIFIER=<IDENTIFIER> yarn hardhat run ./packages/scripts/src/upgrade-tests/add-identifier/1_Verify.ts --network localhost
```
