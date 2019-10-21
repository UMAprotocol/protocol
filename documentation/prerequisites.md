# Prerequisites

After completing these set up steps, we'll be ready to start developing with the UMA system.

## Core

Start in the top-level directory in this repository, `protocol/`.

1. Install nodejs v11.15.0 and ensure that npm is installed along with it.
2. Run `npm install` in `protocol/`.

We should be able to compile the smart contracts from `protocol/core`:

```
cd core
$(npm bin)/truffle compile
```

If everything worked, we should see the line "> Compiled successfully using:" in the output.

## Ganache

1. Install the [Ganache UI](https://truffleframework.com/ganache).
2. Run Ganache on localhost port `9545` (use the above links for instructions on how to do this).

If everything was setup correctly, we should be able to run automated tests from `protocol/core`:

```
cd core
$(npm bin)/truffle test --network test
```

All tests should pass.

## UMA token builder

First, we'll set up the dependencies for the UMA token builder.
1. Run `cd sponsor-dapp-v2`.
1. Run `npm install`.

Next, we'll set up the MetaMask Chrome extension and connect it to our locally running instance of Ganache.

1. Install [Metamask](https://metamask.io/) in Chrome.
1. Set MetaMask to connect to Custom RPC network "http://localhost:9545".
1. In MetaMask, click "Import using account seed phrase" and use the seed phrase from Ganache.
