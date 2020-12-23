# @uma/liquidator

This package contains the UMA Liquidation bot reference implementation. This executable will watch an
ExpiringMultiParty contract for undercollateralized positions and liquidate them.

## Installing the package

```bash
yarn global add @uma/liquidator
```

## Running the liquidator

The simplest way to run the liquidator (with default parameters and price feeds) is:

```bash
EMP_ADDRESS=0x1234 CUSTOM_NODE_URL=your.node.url MNEMONIC="your mnemonic here" liquidator --network mainnet_mnemonic
```

## Other networks and private keys

Check out [the docs](https://docs.umaproject.org/developers/setup#keys-and-networks) for more options on how to plug in your private keys in different ways or use different networks.

## More customization options

See [here](index.js#L189-L209) for a full list of environment variables that can be provided to customize the disputer.
