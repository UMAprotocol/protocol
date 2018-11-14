# Trader App

## Install

All that's needed to install all required packages is running `npm install` from the `trader/` directory.


## Running

1. Run `truffle develop` from the top level (`protocol/`) directory.
1. Once the truffle console is running, run the following commands:
```js
compile --reset
migrate --reset
var voteToken;
OracleMock.deployed().then(instance => {voteToken = instance});
```
1. Once the above commands have executed, run the follwing command to set an initial mock oracle price:
```js
voteToken.addUnverifiedPrice(web3.toWei('1', 'ether'), {from:web3.eth.accounts[0]});
```
1. Make sure you have metamask or mist configured in your browswer and connected to truffle developer chain. This requires:
    - Installation
    - Configure a Custom RPC that points to url http://127.0.0.1:9545
    - Sign in using mnemonic printed out near the top of the initial `truffle develop` output. To do this (with metamask) you click "Import account using seed phrase", on popup enter mnemonic and create a pasword.
1. In a separate terminal, run `npm run link-contracts && npm start` from the `trader/` directory.

## Contributing

1. Before submitting a PR, be sure to run `npm run prettier` from the `trader/` directory to format the code.
