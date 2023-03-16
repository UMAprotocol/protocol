## GovernorV2, VotingV2 and ProposerV2 upgrade

These scripts deploy the GovernorV2, SlashingLibrary, VotingV2, ProposerV2, EmergencyProposer and VotingUpgrader contracts and execute the Proposer operations for the migration from Governor, Proposer and Voting to GovernorV2, ProposerV2 and VotingV2. The verification script checks that the migration has been correctly executed. The latter will print the command to run to test the downgrade if needed. This should only be run in testnets or mainnet forks.

1.Run a local forked node:

```
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
```

2.Run the simulation scripts:

Optional: Set up the fork by impersonating the required accounts.

```
./packages/scripts/setupFork.sh
```

2.1 Deploy VotingV2, GovernorV2, ProposerV2, VotingUpgraderV2, EmergencyProposer contracts:
Run:

```
cd packages/scripts/
```

Then run:

```
yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost
```

From this point the scripts will log the next step to be executed. But below is a summary of the steps:

2.2 Propose migration transactions:

```
GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \ # If not provided, the script will use the first account in the node
VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
VOTING_UPGRADER_ADDRESS=<VOTING-UPGRADER-ADDRESS> \
GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
PROPOSER_V2_ADDRESS=<PROPOSER-V2-ADDRESS> \
EMERGENCY_PROPOSER_ADDRESS=<EMERGENCY-PROPOSER-ADDRESS> \
EMERGENCY_EXECUTOR=<EMERGENCY-EXECUTOR-ADDRESS> \
PROPOSER_ADDRESS=<OPTIONAL-PROPOSER-ADDRESS> \
GOVERNOR_ADDRESS=<OPTIONAL-GOVERNOR-ADDRESS> \
VOTING_ADDRESS=<OPTONAL-VOTING-ADDRESS> \
TEST_DOWNGRADE=<OPTIONAL-RUN-TEST-DOWNGRADE-TRANSACTIONS> \
EMERGENCY_PROPOSAL=<OPTIONAL-RUN-EMERGENCY-PROPOSAL> \
yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network localhost
```

PROPOSER_ADDRESS, GOVERNOR_ADDRESS, VOTING_ADDRESS and TEST_DOWNGRADE are optional. If not provided, the script will use the proposer, governor, and voting contracts already deployed in the network.

If TEST_DOWNGRADE is set to true, the script will also propose the transactions to downgrade the contracts. Therefore TEST_DOWNGRADE shouldn't be set to true in the mainnet.

If EMERGENCY_PROPOSAL is set to true, the script run the proposal as an emergency proposal trough the EmergencyProposer contracts. Therefore EMERGENCY_PROPOSAL shouldn't be set to true in the mainnet.

2.3 Simulate with:

```
NODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network localhost
```

or if during the test of the downgrade and voting with voting v2 with:

```
VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
PROPOSER_V2_ADDRESS=<PROPOSER-V2-ADDRESS> \
EXECUTOR_ADDRESS=<VOTING-UPGRADER-V2-UPGRADER-ADDRESS> \
NODE_URL_1=http://127.0.0.1:9545/ \
yarn hardhat run ./src/admin-proposals/simulateVoteV2.ts --network localhost
```

or if during the test of the emergency proposal and voting with voting v2 with:

```
EMERGENCY_PROPOSER_ADDRESS=<EMERGENCY-PROPOSER-ADDRESS> \
yarn hardhat run ./src/admin-proposals/simulateEmergencyProposal.ts --network localhost
```

2.4 Verify the result:

```
VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
PROPOSER_V2_ADDRESS=<PROPOSER-V2-ADDRESS> \
EMERGENCY_PROPOSER_ADDRESS=<EMERGENCY-PROPOSER-ADDRESS> \
EMERGENCY_EXECUTOR=<EMERGENCY-EXECUTOR-ADDRESS> \
PROPOSER_ADDRESS=<OPTIONAL-PROPOSER-ADDRESS> \
GOVERNOR_ADDRESS=<OPTIONAL-GOVERNOR-ADDRESS> \
VOTING_ADDRESS=<OPTONAL-VOTING-ADDRESS>\
yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost
```

2.5 Simulate basic voting functionality if in the upgraded state:

```
yarn hardhat run ./src/upgrade-tests/voting2/3_SimulateVoting.ts --network localhost
```
