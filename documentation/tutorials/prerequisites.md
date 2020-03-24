# Prerequisites

After completing these set up steps, we'll be ready to start developing with the UMA system.

## Core

Start in the top-level directory in this repository, `protocol/`.

1. Install the latest stable version of nodejs and ensure that npm is installed along with it.
2. Run `npm install` in `protocol/`.

We should be able to compile the smart contracts from `protocol/core`:

```bash
cd core
$(npm bin)/truffle compile
```

If everything worked, we should see the line "> Compiled successfully using:" in the output.

## Ganache

1. Install the [Ganache UI](https://truffleframework.com/ganache).
2. Run Ganache on localhost port `9545` (use the above links for instructions on how to do this).

If everything was setup correctly, we should be able to run automated tests from `protocol/core`:

```bash
cd core
$(npm bin)/truffle test --network test
```

These tests will take a while to finish, but if set up correctly, all tests should pass.
