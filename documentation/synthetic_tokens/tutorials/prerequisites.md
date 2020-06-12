# Prerequisites

After completing these set up steps, we'll be ready to start developing with the UMA system locally.

The following steps require the `git` CLI to be installed. If you are on Windows, you can install via Git Bash Shell ([link](https://gitforwindows.org/)).

## Core

Clone the UMA [repo](https://github.com/UMAprotocol/protocol). Start in the top-level directory in this repository, `protocol/`.

1. Install the latest stable version of [Node.js](https://nodejs.org/) and ensure that `npm` is installed along with it.
2. Run `npm install` in `protocol/`.

We should be able to compile the smart contracts from `protocol/core`:

```bash
cd core
npx truffle compile
```

If everything worked, we should see the line "> Compiled successfully using:" in the output.

## Ganache

Ganache-CLI was already installed via `npm install` and now we will use it to run a test-chain with this command:

```bash
npx ganache-cli -p 9545 -e 1000000 -l 10000000
```

Here, we are running Ganache:

- On localhost port `9545`
- Initializing the test accounts with 1000000 ETH
- Setting a maximum gas limit of 10 million

This will make sure we have enough ETH and a high enough gas limit to deploy our larger contracts.

If everything was setup correctly, we should be able to run automated tests from `protocol/core`. In a separate terminal, run the following commands from the `protocol/core` directory:

```bash
cd core
npx truffle test --network test
```

These tests will take a while to finish, but if set up correctly, all tests should pass (with the possible exception of a few that depend on the Intrinio API).

## Keys and Networks

When using UMA infrastructure, you often have to open the `truffle console` or run a script using `truffle exec`. When
using truffle in the context of this repository, it's important to understand what types of keys you can use and what
to specify for the `--network` argument.

### Public Networks

Public networks include the Ethereum mainnet and any public testnets, like Rinkeby, Kovan, or Ropsten. If you are using
these networks, you'll generally need to know:

1. Which public network you intend to use.
   A list of UMA supported networks is available [here](https://github.com/UMAprotocol/protocol/blob/master/common/PublicNetworks.js).

2. What private key you want to use and how your private keys are stored.
   Below is information regarding the two types of keys that are supported, mnemonics/seed phrases and hardware wallets.

The `--network` parameter that's passed to all truffle commands depends on both of these factors. Here's an example:

```bash
npx truffle console --network rinkeby_mnemonic
```

That command will tell truffle that the user wants to use the Rinkeby testnet and their private key is a mnemonic, or
seed phrase. Generally, the network argument is structured as `--network [NETWORK_NAME]_[KEY_TYPE]`.

### Mnemonic, or seed phrase (less secure)

Mnemonics are much less secure than using a hardware wallet, but they are also much faster when sending multiple
transactions since they don't require as much user input. If you'd like to use a mnemonic, you'll need to start by
putting the mnemonic in your shell environment. Do this by running the following command:

```bash
export MNEMONIC="YOUR_MNEMONIC_HERE"
```

With a real mnemonic, this would look like:

```bash
export MNEMONIC="candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
```

Once you've done that you're ready to run a truffle command. When using a mnemonic, your network argument should look
like `--network [NETWORK_NAME]_mnemonic`. So, for example, using a mnemonic on Kovan would look like:

```bash
npx truffle console --network kovan_mnemonic
```

### Hardware wallets (more secure)

Hardware wallets are the more secure way to interact with the system on public networks. We currently only support
Ledger hardware wallets, but we plan on supporting more in the future.

To set up a Ledger hardware wallet for use with our system:

1. Connect the device to your machine.

2. Use your passcode to unlock it.

3. Ensure the Ethereum app is installed on your device. Install it if not.

4. Select the Ethereum app on the device.

5. Go to the Ethereum app settings on the device and change the "Contract data" setting to yes if it isn't already.

Now that you're set up, you should be able to run truffle commands with the network argument
`--network [NETWORK_NAME]_ledger`. Note: this network uses the default Ledger Live derivation path: `m/44'/60'/x'/0/0`.
For the legacy derivation path (`m/44'/60'/0'/x`), use `[NETWORK_NAME]_legder_legacy`.

For example, you could connect your ledger wallet to the truffle console and begin running commands against mainnet
with the following command:

```bash
npx truffle console --network mainnet_ledger
```

Note: outgoing transactions will require manual approval on the ledger device. If you fail to approve, the command will
hang.
