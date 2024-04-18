Register a new Parent Messenger in the OracleHub and GovernorHub contracts in mainnet.

Console 1

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<KEY> --port 9545 --no-deploy
```

Console 2

```
./packages/scripts/setupFork.sh

yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger-and-gas-limit/0_Propose.ts --network localhost

yarn hardhat run ./packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost

yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger-and-gas-limit/1_Verify.ts --network localhost
```
