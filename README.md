# UMA Protocol

## Contact

- [Slack](umaprotocol.slack.com): to join, use this
[invite link](https://join.slack.com/t/umaprotocol/shared_invite/enQtNTk4MjQ4ODY0MDA1LWZiYjg3ODY2M2MwZGQ3MDVjZDc1ZjUwNDJkMTA5NDZlNzFlZDYxYmQxOTAwNTY1NmZlNGRjY2IxYzUzNjQ0YjI).
Please use Slack for all technical questions and discussions.
- [Email](mailto:hello@umaproject.org): for anything non-technical.

## System Deployment

### Initial Setup

Before attempting to do anything with the system, please run the following commands:

1. Install nodejs and npm
1. Run `npm install`.
1. Run `cd core`. You'll need to be in the `core` directory to run any truffle commands against the system. 
1. Run `$(npm bin)/truffle compile` to compile the contracts.

### Motivating Example: Deploying a test BTC/ETH tracking token on a local Ganache instance

Before starting this example, ensure you have done the [initial setup](#initial-setup) and are in the `core` directory.

1. Follow [these instructions](#deploying-to-ganache) to set up and deploy to Ganache. Note: this means that you should
be using the network `test` throughout these instructions.
2. To configure the price feed to track BTC/ETH rather than futures contracts that require an API key, you'll need to
change the names of two files:
```
mv config/identifiers.json config/identifiersProdBackup.json
mv config/identifiersTest.json config/identifiers.json
```
3. Follow [these instructions](#upload-prices-to-the-manualpricefeed) to begin uploading BTC/ETH prices to your
price feed.
4. Follow [these instructions](#running-the-dapp) to begin running the dapp and launching contracts.

### Deploying to Ganache

1. Install the [Ganache UI](https://truffleframework.com/ganache). You can also use
[ganache-cli](https://github.com/trufflesuite/ganache-cli) if you prefer to use the command line.
2. Run Ganache on localhost port `9545` (use the above links for instructions on how to do this).
3. To deploy to Ganache, run:
```
$(npm bin)/truffle migrate --reset --network test
```

4. To run the automated tests, run:
```
$(npm bin)/truffle test --network test
```
5. If you want to use the dapp with your Ganache deployment, make sure you plug the mnemonic that it generates into
Metamask instead of your normal ETH account.

### Mainnet/Ropsten Testnet Deployment

1. Load your wallet mnemonic and Infura API key into your environment as such:
```
export MNEMONIC="candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
export INFURA_API_KEY=1234abcd1234abcd1234abcd1234abcd
```
2. Ensure your wallet has enough ETH to pay for the deployment (can take up to 0.4 ETH with the default gas settings).
3. Tune the default gas price in `truffle.js` (currently set to `20 Gwei`) to your liking.
4. Run the following command to start a fresh deployment to mainnet:
```
$(npm bin)/truffle migrate --reset --network mainnet_mnemonic
```
If you'd like to deploy to the Ropsten testnet instead, run the following command:
```
$(npm bin)/truffle migrate --reset --network ropsten_mnemonic
```

5. Note: mainnet and testnet deployments do not automatically whitelist addresses. To whitelist your address, run the
following command:
```
$(npm bin)/truffle exec test/scripts/WhitelistSponsor.js --sponsor <your_address_here> --network <network_name>
```

### Load UMA Mainnet and Testnet Deployments

If you'd like to load the official UMA deployment instead of doing your own deployment, run the following commands:
```
$(npm bin)/truffle compile
$(npm bin)/apply-registry
```

Note: the mainnet and testnet deployments are whitelisted, so you will not be able to do much more than call `view`
functions on these contracts unless you've been whitelisted previously.

Please do not run any security tests against the mainnet deployment. 

### Upload Prices to the `ManualPriceFeed`

After deploying the contracts to your network of choice, you can upload prices to the `ManualPriceFeed` contract for
use by any derivatives that you choose to deploy. The script defaults to publishing `ESM19` and `CBN19` every 15
minutes. Depending on the types of price feeds configured in your `core/config/identifiers.json` file, you may need some
API keys in your environment:
- Crypto price feeds (like `BTCETH` or `ETHUSD`): no environment variables are required.
- Futures price feeds (like `ESM19` or `CBN19`): a barchart key must be set as an environment variable called
`BARCHART_API_KEY`. A barchart key is required whenever the key-value pair `"dataSource": "Barchart"` is present in
`identifiers.json`.
- Equities price feeds (like `SPY`): an AlphaVantage key must be set as an environment variable called
`ALPHAVANTAGE_API_KEY`. An AlphaVantage key is equired whenever `"dataSource: AlphaVantageCurrency"` or
`"dataSource: AlphaVantage"` is present in `identifiers.json`.


You can run this script using the following command:
```
./publishPrices.sh --network <network>
```
For the script to succeed, the `build` directory must contain the `ManualPriceFeed` address for the specified network.

### Running the dApp

After deploying to Ganache, ropsten, or mainnet (or any combination of those), you can run the Sponsor Dapp against the
contracts. Before running the dApp, make sure you have done the following:
- Make sure that you have [Metamask](https://metamask.io/) installed.
- Make sure you've provided your ETH account mnemonic to metamask.
    - If you're using the Ganache GUI, this should be available near the top of the page in the accounts (default) tab.
    - If you're using Ganache CLI, this should be printed when you start it.
    - If you're running against mainnet or testnet, you should use your own mnemonic.
- Make sure you select the correct account.
    - If you're using Ganache, the only account that will be whitelisted will be the second account associated with
    your mnemonic. If you only have one account in Metamask, you can use the `Create Account` button to create a
    second. You will need to select the second account if you'd like to launch contracts in the dapp.
- Make sure you have the correct network selected in metamask.
    - If you're using Ganache, you'll need to create a custom RPC with the following URL: `http://127.0.0.1:9545`.

Once you've done the above, you can start the dapp by running the following commands from the `protocol` (top level)
directory:
```
cd sponsor-dapp
npm install
npm run link-contracts
npm start
```

This should automatically start the dApp in your browser. If it doesn't start on its own, you can enter following URL
into your browser: `localhost:3000`.

### Interacting with contracts directly in the truffle console

Make sure you've done the [initial setup](#initial-setup) and either [deployed to Ganache](#deploying-to-ganache),
[deployed to a public network](#mainnetropsten-testnet-deployment), or
[loaded the UMA deployment](#load-uma-mainnet-and-testnet-deployments). If you are using a mainnet or testnet
deployment, make sure you load a mnemonic and infura API key into your environment as shown
[here](#mainnetropsten-testnet-deployment).

You can open a truffle console (a light wrapper around a node console) by running the following command and
substituting `your_network_name` with the name of the network you deployed to:

```
$(npm bin)/truffle console --network your_network_name
```

### Troubleshooting

- Run `git diff`. If you see any changes that were unintended, remove them. If you notice any changes in`package.json`,
you should remove them and run:
```
rm -rf node_modules
npm install
```

## Security and Bug Bounty

Please report all security vulnerabilities through our [HackerOne bug bounty page](https://hackerone.com/uma_project).
Please run all security tests against the testnet deployment or a local Ganache to preserve the integrity of the
mainnet deployment.

## Developer Information and Tools

### Solhint - Solidity Linter
Find more information about solhint [here](https://protofire.github.io/solhint/). There are plugins available to see solhint errors inline in many IDEs.

- Make sure you've run `npm install`.
- To run over all contracts under `contracts/`:
```
$(npm bin)/solhint contracts/**/*.sol
```

### Running Prettier JS Formatter
To run prettier over the `.js` files in the repo, run:
```
npm run prettier
```

## Coverage
We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
These can be generated manually by developers. There are no regression tests or published reports. CircleCI does
generate a coverage report automatically, but if you'd like to generate it locally, run:
```
npm run coverage
```
The full report can be viewed by opening the `coverage/index.html` file in a browser.

## Style Guide

See [STYLE.md](STYLE.md).

## Roadmap for the Oracle
The current iteration of the system relies on a centrally controlled oracle to settle financial contracts with correct prices. To provide truly universal market access, future iterations will open up the system to allow outside participation while still providing guarantees about correct behavior, even with assumptions of arbitrary (byzantine) behavior. Look forward to our second whitepaper where we outline our vision for a trustless oracle.
