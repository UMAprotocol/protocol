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
2. Ensure your wallet has enough ETH to pay for the deployment (can take up to 0.4 ETH with the default gas settings).
3. Tune the default gas price in `truffle.js` (currently set to `20 Gwei`) to your liking.
4. Run the following command to start a fresh deployment to mainnet:
```
$(npm bin)/truffle migrate --reset --network mainnet
```
If you'd like to deploy to the Ropsten testnet instead, run the following command:
```
$(npm bin)/truffle migrate --reset --network ropsten
```
5. To interact with the contracts you've deployed, run:
```
$(npm bin)/truffle console --network <mainnet_or_ropsten>
```
This will open a node console with all contracts loaded along with a web3 instance connected to the network and
preloaded with your private keys (loads the first two private keys for your mnemonic by default).

### Upload Prices to the `ManualPriceFeed`

After deploying the contracts to your network of choice, you can upload prices to the `ManualPriceFeed` contract for
use by any derivatives that you choose to deploy. The script defaults to publishing `BTC/ETH`, `SPY/ETH`, and `CNH/USD`
every 15 minutes. You can run this script using the following command:
```
./publishPrices.sh <ManualPriceFeed contract address> <network>
```

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
