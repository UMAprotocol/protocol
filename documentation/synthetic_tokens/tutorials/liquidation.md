# Liquidation and Dispute Bots

## Motivation

The prompt and accurate execution of liquidations and disputes is a core assumption to all priceless financial contracts compatible with the UMA DVM.
Liquidation and dispute bots, as described below and implemented [here](https://github.com/UMAprotocol/protocol/tree/master/liquidator) and [here](https://github.com/UMAprotocol/protocol/tree/master/disputer), are infrastructure tools that will help maintain the overall health of the UMA ecosystem.
They are currently compatible with the priceless synthetic token contract template, as described [here](../explainer.md) and implemented [here](https://github.com/UMAprotocol/protocol/tree/master/core/contracts/financial-templates).

The liquidation bot monitors all open positions within a given expiring multi-party contract and liquidates positions if their collateralization ratio, as inferred from off-chain information about the value of the price identifier, drops below a given threshold.

The dispute bot monitors all liquidations occurring within a given expiring multi-party contract and initiates disputes against liquidations it deems invalid, as inferred from off-chain information about the value of the price identifier.
A liquidation is invalid if a position was in fact overcollateralized at the time of liquidation.

## Implementation

The liquidation and dispute bots are separate entities, each has its own wallet and are designed to be be run independently of one and other. This decouples dependencies between the bots to decrease the risk of one crashing impacting the other. The bots are written in Javascript and re-use much of the upstream codebase. In production, it is suggested to run the bots within docker containers to further isolate the bots from any systemic risk and to ensure a reproducible execution environment.

## Technical Tutorial

This tutorial will be broken down into three sections: 1) running the bots directly from your host environment (no docker) from the command line 2) running the bots within a dockerized environment from the official UMA docker image and 3) deploying bots to production in Google Cloud Compute.

This tutorial will guide you through setting up a liquidator and disputer bot to monitor an expiring multi party deployed on the Kovan test network. A verified version of the expiring multi party contract can be found on Kovan [here](https://kovan.etherscan.io/address/0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1). This contract is an ETHBTC synthetic, collateralized in Dai.

## Prerequisites

### Funding accounts

Bots require to be funded with currency to pay for liquidations and disputes.
Specifically, if you want to run a liquidator bot, you need to fund the wallet with 1) synthetic tokens to pay off liquidated positions, 2) collateral currency to pay the DVM final fee and 3) Ether to pay transaction fees. If you want to run a disputer bot then this wallet should be funded with collateral currency to pay dispute bonds and the DVM final fee and Ether to pay for transactions.

### Bot private key management

All deployment configurations require a wallet mnemonic (or private key) to be injected into the bots enabling them to submit transactions to preform on-chain liquidations and disputes. You can either bring your own mnemonic from an existing wallet or generate a fresh one using the `bip39` package installed within the UMA repo. If you have a wallet mnemonic already you can skip this section.

To generate a new mnemonic you can run the following from the `/core` directory:

```
// Start the truffle console
truffle console --network kovan_mnemonic

// Generate a new mnemonic phrase
const bip39 = require('bip39')
bip39.generateMnemonic()
// Your new mnemonic will be generated. Keep this safe for the next steps.
'sail chuckle school attitude symptom tenant fragile patch ring immense main rapid'
```

You can then load this mnemonic into truffle and view the associated public key. To do this, exit the the truffle console by pressing `ctrl+c` twice on your keyboard and then typing:

```
// Add the new mnemonic to your environment variables
export MNEMONIC="sail chuckle school attitude symptom tenant fragile patch ring immense main rapid"

// Start the truffle console
truffle console --network kovan_mnemonic

// Print the address of your newly created account
accounts[0]
0x45Bc98b00adB0dFe16c85c391B1854B706b7d612
```

You can now fund this wallet with the associated currency for the type of bot you want to run. To learn more about funding wallets see tutorial XXX //TODO

### Creating a price feed API key.

All bots require a price feed to inform their liquidation decisions. For this you must create an account :TODO add the website here. Keep this key handy. You'll need it when configuring the bots.

## 1. Running the liquidator and disputer bots locally

**a. Install dependencies**

Run the following from the root directory to install dependencies and compile the contracts:

```
// Install dependencies
npm install
truffle compile
```

**b. Configuring environment**

The bots can be easily run directly from your local development environment. To start a bot the first step is to configure the bot's settings. Liquidations bots require 4 main configurations settings which are configured using environment variables. To set this up create a `.env` file in the root of the protocol directory with the following in it:

```
POLLING_DELAY=30000
EMP_ADDRESS=0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1 \\current kovan address.
MNEMONIC=sail chuckle school attitude symptom tenant fragile patch ring immense
PRICE_FEED_CONFIG={"type":"medianizer","apiKey":"YOUR_API_KEY","pair":"ethbtc","lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},{"type":"cryptowatch","exchange":"binance"},{"type":"cryptowatch","exchange":"bitstamp"}]}
```

- `POLLING_DELAY`: how long the bot should wait (in milliseconds) before running a polling cycle.
- `EMP_ADDRESS`: address of the deployed expiring multi party contract on the given network you are wanting to connect to. This config defines the synthetic that the bot will be liquidating. A list of available addresses can be found HERE //TODO.
- `MNEMONIC`: generated before hand or in the steps outlined in key generation.
- `PRICE_FEED_CONFIG` configuration object used to parameterize the bot's price feed. It's broken down as follows:
  - `type` spesifies the configuration of the price feed. The `medianizer` type averages the price of the identifier over a set of diffrent exchanges.
  - `apiKey` is the key generated in API key section of the Prerequisites.
  - `pair` defines the crypto pair to medianizer over.
  - `lookback` defines a window size, in seconds, over which an average price is taken.
  - `minTimeBetweenUpdates` min number of seconds between update.
  - `medianizedFeeds` is an array of type `priceFeed` that defines the feeds overwhich the meadinzer will average. Each of these have their own components which are defined as:
    - `type` Each instance of the meadinaizer also a type. This could be a `medianizer`, `uniswap` or `cryptowatch` depending on the configuration of the bot. The sample bot is using only `cryptowatch` price feeds to average over the set of exchanges to medianize.
    - `exchange` a string identifier for the exchange to pull prices from. This should be the identifier used to identify the exchange in CW's REST API.

Note that the paremtets in the example above conform to [UMIP-2](<[../..](https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-2.md#implementation)>)'s specification.

**3. running the bot**
Now that your env is set up you can run the bot. Run the following command from the `core` directory to start the bot on Kovan:

```
truffle exec ../liquidator/index.js --network kovan_mnemonic
```

This will start the bot process using the network `kovan` and the wallet `mnemonic`. You should see the following output:

```
Using network 'kovan_mnemonic'.

2020-05-21 12:15:15 [info]: {
  "at": "liquidator#index",
  "message": "liquidator started 🕵️‍♂️",
  "empAddress": "0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1",
  "pollingDelay": "30000"
}
... the bot prints its configuration and starts running ...
```
