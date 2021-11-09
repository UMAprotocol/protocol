# Uma Serverless Ingestor App

This is the application for ingesting data into Google Datastore. It is designed to run on a schedule basis, so it has to be lightweight and stateless.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}

# Provide authentication credentials to the api application to be able to use Google Datastore service
GOOGLE_APPLICATION_CREDENTIALS=<path_to_json_file>

# these configure synthetic price feed. These price feeds may require paid api keys.
cryptowatchApiKey=
tradermadeApiKey=
quandlApiKey=
defipulseApiKey=

# 0x price feed gets us market prices on tokens
zrxBaseUrl=https://api.0x.org

# how many days of price history we should query on startup, leave empty to disable, history will start at the time app is started
backfillDays=

# required for lsp and emp state updates. this is a valid multicall2 address on mainnet.
MULTI_CALL_2_ADDRESS=0x5ba1e12693dc8f9c48aad8770482f4739beed696

# any non null value will turn on debugging. This adds additional logs and time profiles for key calls.
debug=1

# LSP Creator addresses are used to discover deployed lsp contracts. Currently we have to manually specify old creator addresses
lspCreatorAddresses=0x0b8de441B26E36f461b2748919ed71f50593A67b,0x60F3f5DDE708D097B7F092EFaB2E085AC0a82F42,0x31C893843685f1255A26502eaB5379A3518Aa5a9,0x9504b4ab8cd743b06074757d3B1bE3a3aF9cea10

# Overwrite the default Emp Registry Contract address
EMP_REGISTRY_ADDRESS=0x...

# optional parameter for defining a custom chain id (1: mainnet, 137: polygon, ...)
NETWORK_CHAIN_ID=1
```

## Build

`yarn build`

## Starting

Assuming all dependencies are installed and `.env` is configured:

from package script:
`yarn serverless_write`

or directly:
`npx ts-node src/start.ts serverless_write`
