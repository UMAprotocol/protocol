# Deploy your own price feed

In this tutorial, we'll deploy our own price feed for use with synthetic tokens on testnet. Note: this will be
necessary if the identifier (or underlying asset) you want to track isn't supported. For a list of supported
identifiers, see [identifiers.json](https://github.com/UMAprotocol/protocol/blob/master/core/config/identifiers.json).

If you'd like more information on what an identifier is and how to configure a price feed, please see
[our explainer](../explainers/price_feed_configuration.md).

## Prerequisites

All of our tutorials require that you complete the steps in [Prerequisites](./prerequisites.md).

## Deploy the contract to rinkeby

The UMA testnet contracts are deployed to rinkeby, so for the rest of the tutorial, it's assumed you'll be interacting
with that network.

A few notes on the wallet you should use to interact with the Rinkeby testnet:

- You should not do this with a wallet that holds mainnet assets.

- You should make sure that this wallet has Rinkeby ETH. If not, you can use [this faucet](https://faucet.rinkeby.io/)
to get some.

- You'll need the mnemonic (seed phrase) for this wallet to add it to truffle, so make sure it's generated from a
mnemonic. If you create the wallet through Metamask, for example, it will give you a mnemonic to write down.

You'll need to add this wallet to your environment by entering the following command replacing `your mnemonic here`
with your mnemonic:

```bash
export MNEMONIC="your mnemonic here"
```
Alternatively, you can create a `.env` file to store your mnemonic. This is useful as it will preserve your environment 
between bash sessions. To do this copy the sample provided `.env` file and replace it with your own mnemonic. This can
be done by running the following from the `core/` directory:
```bash
cp .env_sample .env
```

Next, edit the .env file that is created in the `core/` directory to store your mnemonic. 
Once you've done this you are ready to create your price feed. First, you'll need to open the truffle console to directly send 
commands to the blockchain. To do so, run the following command from the `core/` directory:
```bash
$(npm bin)/truffle console --network rinkeby_mnemonic
```

Now that you're in the truffle console, you can deploy your new price feed contract:
```js
> let price_feed = await ManualPriceFeed.new(false)
```

Next, you'll want to print out the address of your new contract, so you can point your scripts and contracts at it:
```js
> price_feed.address
```

You should see the price feed address printed in the console. Copy and paste that address somewhere so you have it on
hand. You can now exit the truffle console by pressing ctrl-c a few times.

## Add your price feed to your local configuration

To use your price feed with any of the UMA scripts, you'll need to add it to the configuration. To do so, open the file
`core/networks/4.json`. Find the follwing lines near the end of that file:

```json
  {
    "contractName": "LeveragedReturnCalculator",
    "address": "0x756B875Da7c30B8Ab15fa05cFEc28a9d7065abeA"
  }
```

Once you've found those lines, change them to the following replacing `PRICE_FEED_ADDRESS_HERE` with the address for
the price feed contract you deployed above:
```json
  {
    "contractName": "LeveragedReturnCalculator",
    "address": "0x756B875Da7c30B8Ab15fa05cFEc28a9d7065abeA"
  },
  {
    "contractName": "ManualPriceFeed",
    "address": "PRICE_FEED_ADDRESS_HERE"
  }
```

Save the file, and run the following command from the `core/` directory:
```bash
$(npm bin)/apply-registry
```

You've now updated the configuration to use your price feed contract.

## Upload prices to your price feed contract

To use your price feed, you'll need to add a price to it. You'll need to add a price for one of the identifiers that's
already approved in the testnet DVM. We recommend using the identifier `Custom Index (1)`.

To push a price, you'll need to know the price you want to push and the unix timestamp (must be now or in the past).
Run the following command (from the `core/` directory) replacing `<price>` with your price and `<time>` with the UNIX
timestamp in seconds:
```bash
$(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier 'Custom Index (1)' --price <price> --time <time> --network=rinkeby_mnemonic
```

For example, if the 'Custom Index (1)' was used to represent a number of Twitter followers a person had at 10000 on 10/21/2019 15:40 EDT, run:

```bash
$(npm bin)/truffle exec scripts/ManualPublishPriceFeed.js --identifier 'Custom Index (1)' --price 10000 --time 1571686800 --network=rinkeby_mnemonic
```

Some notes on using this command:

- The price will be multiplied by 10^18 to convert it to a fixed point integer that Solidity can understand.

- You can repeat this command whenever you want to change the price. You'll only need to make sure that the timestamp
is greater than the previous timestamp you provided, but not in the future.

## Deploy a TokenizedDerivative instance that depends on this price feed

To deploy a Tokenized Derivative that uses your price feed, you'll want to change the `priceFeedAddress` parameter to
your price feed address from above and the `product` parameter to `Custom Index (1)` (converted to `bytes32`). The
specific instructions for how to deploy a custom TokenizedDerivative are in
[this tutorial](./customizing_tokens_via_cli.md) - you'll just need to remember these two parameters.
