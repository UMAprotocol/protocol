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
- Compile contracts by running `yarn truffle compile` from the root of the repo.

### Testing

`./run_tests.sh` Will run you through a comprehensive guide for testing the voter dApp with normal and admin price requests.

### Vote through the designated voting proxy

Voting by proxy is identical to voting on price requests without proxy but you first need to deploy and set up the designated voting proxy contract. To do that, find the "Two key voting" component on the dApp. Enter a cold storage account into the form and deploy the contract by clicking "Deploy". For testing purposes, its reasonable to use your current hot wallet as your cold wallet. The dApp should detect your newly deployed voting proxy and display it in the top right corner: "Voting with contract...". Finally, a new button, "Transfer", should appear which will prompt you to transfer your voting tokens to the proxy contract. At this point, all voting actions (`batchCommit` and `batchReveal`) will be submitted from the proxy contract.

More information about cold versus hot wallets can be found [here](https://docs.umaproject.org/uma/oracle/voting_with_UMA_2-key_contract.html).

## Available Scripts for the voter-dapp directory.

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>
You will also see any lint errors in the console.

### `yarn build`

Builds the app for production to the `build` folder.<br>
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.
