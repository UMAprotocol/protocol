# @uma/cli

This package contains the UMA CLI tool. This tool works, but is deprecated, so its use is discouraged. It can be useful
for certain tasks, like viewing governance/admin proposals, but it is usually preferred to use tools.umaproject.org or
vote.umaproject.org.

## Installing the package

```bash
yarn add @uma/cli
```

Note: this is a local installation, meaning it instructs yarn to install into the current package/directory. It can be
installed globally if you'd like the executable to be accessible everywhere.

## Running the package with default (empty) keys and node

```bash
yarn uma-cli --network mainnet_mnemonic
```

## Using a custom node URL and mnemonic

By default, this package uses a default infura account that often exceeds its daily quota. To plug in your own node
node URL, set the `CUSTOM_NODE_URL` env variable. It also comes with a default mnemonic -- to override, provide your
mnemonic (seed phrase) using the `MNEMONIC` env variable.

```bash
CUSTOM_NODE_URL=https://your.node.url.io MNEMONIC="your mnemonic (12-word seed phrase) here" yarn uma-cli --network mainnet_mnemonic
```

## Using your private keys

Check out [the docs](https://docs.umaproject.org/developers/setup#keys-and-networks) for more options on how to plug in
your private keys in different ways or use different networks.
