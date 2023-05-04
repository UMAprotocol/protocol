How to test this scripts:

Console 1

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<KEY> --port 9545 --no-deploy
```

Console 2

```
./packages/scripts/setupFork.sh

yarn hardhat run ./packages/scripts/src/upgrade-tests/sherlock-update/0_Deploy.ts --network localhost

ORIGIN_VALIDATOR_ADDRESS=<ADDRESS-FROM-PREVIOUS-SCRIPT> yarn hardhat run ./packages/scripts/src/upgrade-tests/sherlock-update/1_Propose.ts --network localhost

SKIP_EXECUTE=1 yarn hardhat run ./packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost

MNEMONIC=<DEV-WALLET-MNEMONIC>  MULTICALL=1 yarn hardhat run ./packages/scripts/src/admin-proposals/executeProposalV2.ts --network localhost

yarn hardhat run ./packages/scripts/src/upgrade-tests/sherlock-update/2_Verify.ts --network localhost
```
