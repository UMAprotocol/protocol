## Governor V2 and VotingV2 upgrade

These scripts deploy the GovernorV2, SlashingLibrary, VotingV2, and VotingUpgrader contracts and execute the Proposer operations for the migration from Governor to GovernorV2 and Voting to VotingV2. The last script checks that the migration has been correctly executed. They can be deployed on a mainnet fork to imitate their operation.

1.Run a local forked node:

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
```

2.Run the simulation scripts:

Optional: Set up the fork by impersonating the required accounts.

```
./packages/scripts/setupFork.sh
```

2.1 Deploy VotingV2 contracts:
Run:

```
cd packages/scripts/
```

Then run:

```
yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost
```

2.2 Propose migration transactions:

```
VOTING_UPGRADER_ADDRESS=<VOTING-UPGRADER-ADDRESS> \
VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network localhost
```

2.3 Simulate with:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network mainnet-fork
```

2.4 Verify the result:

```
VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost
```
