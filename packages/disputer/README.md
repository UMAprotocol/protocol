# @uma/disputer

This package contains the UMA Dispute bot reference implementation. This executable will watch an ExpiringMultiParty
contract for liquidations and dispute any that it deems to be invalid.

For more information about running a dispute bot, see the [docs](https://docs.umaproject.org/developers/bots).

## Installing the package

```bash
yarn add @uma/disputer
```

Note: this is a local installation, meaning it instructs yarn to install into the current package/directory. It can be
installed globally if you'd like the executable to be accessible everywhere.

## Running the disputer

The simplest way to run the disputer (with default parameters and price feeds) is:

```bash
EMP_ADDRESS=0x1234 CUSTOM_NODE_URL=https://your.node.url.io MNEMONIC="your mnemonic (12-word seed phrase) here" disputer --network mainnet_mnemonic
```

## Other networks and private keys

Check out [the docs](https://docs.umaproject.org/developers/setup#keys-and-networks) for more options on how to plug in your private keys in different ways or use different networks.

## More customization options

See [here](index.js#L189-L209) for a full list of environment variables that can be provided to customize the disputer.
