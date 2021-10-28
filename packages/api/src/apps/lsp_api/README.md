# Uma LSP API App

This is almost identical to the api app, but its been slimmed down and scoped to just LSP contracts. This is mainly
to faciliate local testing on forked nodes, since inclusion of EMP contract slow down API and startup speed significantly.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282

# Optional, defaults to 60 (1 minute): number of seconds before rechecking contract states
UPDATE_RATE_S=

# Optional update rate for price updates, defaults to 900 (15 minutes)
PRICE_UPDATE_RATE_S=

# Optional update rate for detecting new contracts, defaults to 60 (1 minute)
DETECT_CONTRACTS_UPDATE_RATE_S=

# these configure synthetic price feed. These price feeds may require paid api keys.
cryptowatchApiKey=
tradermadeApiKey=
quandlApiKey=
defipulseApiKey=

# 0x price feed gets us market prices on tokens
zrxBaseUrl=https://api.0x.org

# required for lsp and emp state updates. this is a valid multicall2 address on mainnet.
MULTI_CALL_2_ADDRESS=0x5ba1e12693dc8f9c48aad8770482f4739beed696

# any non null value will turn on debugging. This adds additional logs and time profiles for key calls.
debug=1

# LSP Creator addresses are used to discover deployed lsp contracts. Currently we have to manually specify old creator addresses
lspCreatorAddresses=0x0b8de441B26E36f461b2748919ed71f50593A67b,0x60F3f5DDE708D097B7F092EFaB2E085AC0a82F42,0x31C893843685f1255A26502eaB5379A3518Aa5a9,0x9504b4ab8cd743b06074757d3B1bE3a3aF9cea10

# Overwrite the default Emp Registry Contract address
EMP_REGISTRY_ADDRESS=0x...
```

## Starting

Assuming all dependencies are installed and `.env` is configured:

from package script:
`yarn lsp_api`

or directly:
`npx ts-node src/start.ts lsp_api`

## Usage

This app is almost identical to the regular API but does not fetch EMP or synthetic prices ( the slowest things when starting up).
See [api docs]('../api/README.md') for detailed usage.
