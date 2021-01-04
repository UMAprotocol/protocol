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

## Running the package

```bash
yarn uma-cli --network mainnet_mnemonic
```

## Using your own node URL

By default, this package uses a default infura account that often exceeds its daily quota. To plug in your own node
node ULR, export the following env variable:

```bash
CUSTOM_NODE_URL=https://your.node.url.io yarn uma-cli --network mainnet_mnemonic
```

## Using your private keys

Check out [the docs](https://docs.umaproject.org/developers/setup#keys-and-networks) for more options on how to plug in
your private keys in different ways or use different networks.
