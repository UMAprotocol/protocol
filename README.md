# UMA Protocol

## Deployment

### Initial Setup

1. Install nodejs and npm
1. Run `npm install`.
1. Run `$(npm bin)/truffle compile` to compile the contracts.

### Deployment and Testing in Ganache

1. Install the [Ganache UI](https://truffleframework.com/ganache). You can also use
[ganache-cli](https://github.com/trufflesuite/ganache-cli) if you prefer to use the command line.
2. Run ganache on localhost port `9545` (use the above links for instructions on how to do this).
3. To deploy to ganache, run:
```
$(npm bin)/truffle migrate --reset --network test
```
4. To interact with the contracts you've deployed, run:
```
$(npm bin)/truffle console --network test
```
This will open a node console with all contracts loaded along with a web3 instance connected to your ganache instance.

5. To run the automated tests, run:
```
$(npm bin)/truffle test
```

### Mainnet/Testnet Deployment

1. Load your wallet mnemonic into your environment as such:
```
export MNEMONIC="candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
```
2. Set your Infura API key as `INFURA_API_KEY` in your environment.
3. Ensure your wallet has enough ETH to pay for the deployment (can take up to 0.4 ETH with the default gas settings).
4. Tune the default gas price in `truffle.js` (currently set to `20 Gwei`) to your liking.
5. Run the following command to start a fresh deployment to mainnet:
```
$(npm bin)/truffle migrate --reset --network mainnet_mnemonic
```
If you'd like to deploy to the Ropsten testnet instead, run the following command:
```
$(npm bin)/truffle migrate --reset --network ropsten_mnemonic
```
6. To interact with the contracts you've deployed, run:
```
$(npm bin)/truffle console --network <network_name>
```
This will open a node console with all contracts loaded along with a web3 instance connected to the network and
preloaded with your private keys (loads the first two private keys for your mnemonic by default).

If you'd like to interact with the official UMA deployment instead of doing your own deployment, skip steps 1-5
above and run the following commands instead:
```
$(npm bin)/truffle compile
$(npm bin)/apply-registry
```
Please do not run any security tests against our mainnet deployment.

### Upload Prices to the `ManualPriceFeed`

After deploying the contracts to your network of choice, you can upload prices to the `ManualPriceFeed` contract for
use by any derivatives that you choose to deploy. The script defaults to publishing `ESM19` and `CBN19`
every 15 minutes. A barchart key must be set in your environment variable as `BARCHART_API_KEY`. You can run this script using the following command:
```
./publishPrices.sh <network>
```

For the script to succeed, the `build` directory must contain the `ManualPriceFeed` address for the specified network.

### Running the dApp

After deploying to ganache, ropsten, or mainnet (or any combination of those), you can run the Sponsor Dapp against the
contracts by running the following commands:
```
cd sponsor-dapp
npm run link-contracts
npm start
```
This should automatically start the dApp in your browser.

## Security and Bug Bounty

Please report all security vulnerabilities through our [HackerOne bug bounty page](https://hackerone.com/uma_project).
Please run all security tests against the testnet deployment or a local ganache to preserve the integrity of the
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
