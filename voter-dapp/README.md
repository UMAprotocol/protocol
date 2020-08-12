# Voter dApp

This is a browser client that UMA token holders can use to vote on price requests. The dApp interacts with the deployed [DVM](https://docs.umaproject.org/uma/oracle/technical_architecture.html) code using MetaMask's browser extension. The source code was bootstrapped from [Create React App](https://github.com/facebook/create-react-app).

Features currently include:

- Deploy a [designated voting proxy contract](https://docs.umaproject.org/uma/oracle/voting_with_UMA_2-key_contract.html)
- Commit an encrypted vote
- Backup salts associated with latest encrypted votes
- Reveal an encrypted vote
- Retrieve rewards for resolved votes
- View results of resolved votes

Note: this project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Making changes to the Voter dApp

The source code for this React app can be found in `./src`. At a minimum, you must ensure that a user can go through a simple commit and reveal flow, both using a voting proxy and not using one.

### Prerequisites

- Run `yarn` from the root of the repo to install the monorepo's dependencies.
- Compile contracts by running `yarn run truffle compile` from the root of the repo.

### Steps to generate price requests

0. Start at the root of the repository (`protocol/`).
1. Start a local blockchain on port `9545` with enough starting ETH balances and a high enough gas limit:
   ```bash
   ganache-cli -p 9545 -e 10000000000 -l 9000000
   ```
   This seeds every account with `10000000000` ETH and sets the block gas limit to 9 million wei. This tool should also
   display all of the private keys associated with the ganache default accounts. You should keep the private keys handy
   because you will want to import some of them into MetaMask to test the dApp locally.
1. Open another window and deploy all contracts:
   ```bash
   cd core && $(npm bin)/truffle migrate --reset --network test
   ```
1. Make a price request for the "BTC/USD" identifier at the timestamp `1570000000`. Note that the timestamp passed in denotes the Unix Epoch time. This script will take care of registering the chosen price identifier and requesting a price:
   ```bash
   $(npm bin)/truffle exec ./scripts/local/RequestOraclePrice.js --network test --identifier BTC/USD --time 1570000000
   ```
1. Advance time to the next voting round's commit phase so that the price request becomes available to vote on. The default starting phase is the reveal phase so you need to run this script once:
   ```bash
   $(npm bin)/truffle exec ./scripts/local/AdvanceToNextVotingPhase.js --network test
   ```

At this point, the price request is ready to be voted on.

### Steps to vote on price requests through the dApp

0. Open a new console tab and change your directory to `./protocol/voter-dapp` via `cd ../voter-dapp`. At this point, you should have three console tabs open: one that is running `ganache-cli` locally, one for running helper scripts from the previous section, and one to run the voter dapp React app.
1. Start the application: `npm start`
1. Navigate to `localhost:3000` on your browser, sign-in to MetaMask (make sure that the network is pointing to your localhost at port `9545`), and click "Connect to your Ethereum wallet" and sign the authentication message. You will need to import the first account generated from ganache into Metamask; ganache displays all default account private keys upon starting. The reason that you will want to use the first account is that this account is seeded with UMA voting tokens by the migration script `4_deploy_voting_token.js`.
1. The price request should appear under "Active Requests" with the correct "Price Feed", "Timestamp" in readable format, the "Status" should be "Commit" (if it says "Reveal", then you need to advance to the next voting phase), and "Current Vote" should just show an "Edit" button
1. To commit a vote, click "Edit", enter a number, check the box in the column to the right of the price feed identifier, and click "Save" below the "Active Requests" dashboard. You can commit several votes at once. Clicking "Save" will prompt you to sign and submit a [`batchCommit` transaction ](https://docs.umaproject.org/uma/contracts/VotingInterface.html#VotingInterface-batchCommit-struct-VotingInterface-Commitment---).
1. Once you are done committing votes, advance to the reveal phase in your other console tab: `$(npm bin)/truffle exec ./scripts/local/AdvanceToNextVotingPhase.js --network test`
1. Either refresh the page or wait for the dApp to prompt you to sign another message. You will need to sign a message at the beginning of each voting phase. Now, you should see an option to reveal your committed vote.
1. To reveal your vote, check the checkbox and click "Reveal Selected". This will prompt you to sign and submit a [`batchReveal` transaction](https://docs.umaproject.org/uma/contracts/VotingInterface.html#VotingInterface-batchReveal-struct-VotingInterface-Reveal---)
1. If your vote was successfully revealed, the "Status" column should switch to "Revealed"

### Vote through the designated voting proxy

Voting by proxy is identical to voting on price requests without proxy but you first need to deploy and set up the designated voting proxy contract. To do that, find the "Two key voting" component on the dApp. Enter a cold storage account into the form and deploy the contract by clicking "Deploy". For testing purposes, its reasonable to use your current hot wallet as your cold wallet. The dApp should detect your newly deployed voting proxy and display it in the top right corner: "Voting with contract...". Finally, a new button, "Transfer", should appear which will prompt you to transfer your voting tokens to the proxy contract. At this point, all voting actions (`batchCommit` and `batchReveal`) will be submitted from the proxy contract.

More information about cold versus hot wallets can be found [here](https://docs.umaproject.org/uma/oracle/voting_with_UMA_2-key_contract.html).

## Available Scripts for the voter-dapp directory.

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>
You will also see any lint errors in the console.

### `CI=true npm test`

Launches the test runner in non-interactive mode.<br>
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.<br>
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.
