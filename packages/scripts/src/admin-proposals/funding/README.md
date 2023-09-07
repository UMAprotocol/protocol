Funds receiver from UMA governance through a proposal in ProposerV2 and vote in VotingV2. Currently the script only supports single ERC-20 token transfers defaulting to UMA (no native ETH funding).

Console 1

```sh
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<KEY> --port 9545 --no-deploy
```

Console 2

```sh
./packages/scripts/setupFork.sh

RECIPIENT=<FUNDING-RECEIVER-ADDRESS> \
TOKEN=<OPTIONAL-TOKEN-ADDRESS> \
AMOUNT=<FUNDING-AMOUNT> \
PROPOSAL_URL=<PROPOSAL-URL> \
yarn hardhat run ./packages/scripts/src/admin-proposals/funding/0_Propose.ts --network localhost

SKIP_EXECUTE=1 yarn hardhat run ./packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost

TRACE=1 yarn hardhat run ./packages/scripts/src/admin-proposals/executeProposalV2.ts --network localhost
```

Since verifying transfer execution would require manually providing starting balances, it is easier to simulate vote and execute the proposal separately and look for emitted token transfer event in execution traces (`TRACE=1`).
