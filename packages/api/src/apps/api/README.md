# Uma API App

This is the main application for ingesting data, formatting it and exposing it through restful endpoints.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282

# Optional, defaults to 600 (10 minutes): number of seconds before rechecking contract states
UPDATE_RATE_S=600

# Optional update rate for price updates, defaults to 900 (15 minutes)
PRICE_UPDATE_RATE_S=900

# Optional update rate for detecting new contracts, defaults to 60 (1 minute)
DETECT_CONTRACTS_UPDATE_RATE_S=60

# defaults to 864,000,000 ( 10 days): represents the max age a block will stay cached
OLDEST_BLOCK_MS=1

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

## Starting

Assuming all dependencies are installed and `.env` is configured:

from package script:
`yarn api`

or directly:
`npx ts-node src/start.ts api`

## Usage

All queries can be made to `http:localhost:${EXPRESS_PORT}` through a POST.
Example: `curl -X POST localhost:8282/actions` will list available actions

### Usage with Postman

API can be tested with [postman](https://www.postman.com/) through this [link](https://www.getpostman.com/collections/e99f4e09e2443cb31ef4)
You will need to set your environment variable `host` to your deployment of the API, example `http://localhost:8282`.

## Actions

Actions are RPC style function calls which take JSON parameters and return a JSON body. Actions are accessed through the POST method.
This is a non exhaustive list of actions, for the full list see [action source](./services/actions.ts).

The following actions can be called to the server with `curl -X POST localhost:8282/${action}`.
Parameters are attached as JSON to the request body in the follow format: `"[...arguments]"`. Arguments should be attached to the body as an array.

## Channels

Channels are a way to group actions into related sets. Currently channels are used to separate queries
across contract types, but they can theoretically group any action calls together. To call an action on
a channel, use the channel name as part of the path. `curl -X POST localhost:8282/${channel}/${action}`.
Current channels are

- emp - all emp calls
- lsp - all lsp calls
- global - custom calls that are not contract type specific

## Action Client

See [../../examples/action-client.ts](Action Client Code) for an example of how to interface with the api from the client side.

## Emp Api

All calls here are on the emp channel.

### emp/actions() => string[]

Returns a list of all actions

### emp/echo(...args:Json[]) => args

Echos back any parameters you send to the server. For testing connectivity and client correctness.

### emp/listEmpAddresses() => string[]

Returns all known emp addresses for this servers network, which defaults to mainnet.

### emp/lastBlock() => number

Returns the last block number seen.

### emp/listActiveEmps() => Emps[]

Returns all known active emps data. Conforms to the EMP type defined in the uma sdk: `uma.tables.emp.Data`.

### emp/listExpiredEmps() => Emps[]

Returns all known expired emps data. Conforms to the EMP type defined in the uma sdk: `uma.tables.emp.Data`.

### emp/getEmpState(address: string) => EmpState

Get all known state of any emp by its address.

### emp/getErc20Info(address:string) => Erc20Data

Get name, decimals of an erc20 by address.

### emp/getAllErc20Info() => Erc20Data[]

List all known erc20s, collateral or synthetic and all known information about them

### emp/collateralAddresses() => string[]

### emp/syntheticAddresses() => string[]

Returns all known active collateral or synthetic addresses

### emp/allLatestPrices(currency='usd') => {[address:string]:[timestamp:number,price:string]

Returns all known latest prices for synthetic or collateral addresses in wei.

### emp/allLatestMarketPrices() => {[address:string]:[timestamp:number,price:string]

Returns all latest known market prices (based on matcha/0x routing) for synthetic or collateral addresses in wei.

### emp/latestPriceByTokenAddress(tokenAddress:string,currency:'usd') => [timestamp:number,price:string]

Returns latest price for a particular erc20 token address ( emp collateral or synthetic address) in wei.

### emp/latestSyntheticPrice(empAddress: string, currency: CurrencySymbol = "usd") => [timestamp:number,price:string]

### emp/latestCollateralPrice(empAddress: string, currency: CurrencySymbol = "usd") => [timestamp:number,price:string]

Gets the latest collateral or synthetic price based on the emp contract address in wei.

### emp/historicalPricesByTokenAddress(tokenAddress:string,start:number=0,end:number=Date.now(),currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and end in MS, sorted by timestamp ascending from an erc20 token address in wei.
This is useful for charting betwen two dates.

### emp/sliceHistoricalPricesByTokenAddress(tokenAddress:string,start:number=0,length:number=1,currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and count of price samples, sorted by timestamp ascending, from an erc20 token address.
This is useful for paginating data when you have X elements per page, and you know the last element seen.

### emp/historicalSynthPrices( empAddress: string, start = 0, end: number = Date.now()) => PriceSample[]

### emp/historicalCollateralPrices( empAddress: string, start = 0, end: number = Date.now()) => PriceSample[]

Get a range of historical prices between start and end in MS, sorted by timestamp ascending from an emp contract address.
This is useful for charting betwen two dates.

### emp/sliceHistoricalSynthPrices(empAddress: string, start = 0, length = 1) => PriceSample[]

### emp/sliceHistoricalCollateralPrices(empAddress: string, start = 0, length = 1) => PriceSample[]

Get a range of historical prices between start and count of price samples, sorted by timestamp ascending, from an emp contract address.
This is useful for paginating data when you have X elements per page, and you know the last element seen.

### emp/tvl(empAddresses?: string[], currency: CurrencySymbol = "usd") => string

### emp/tvm(empAddresses?: string[], currency: CurrencySymbol = "usd") => string

Returns TVL/TVM of all supplied addresses in USD 18 decimals. If no addresses supplied, returns TVL/TVM of all known contracts.

### emp/tvlHistoryBetween(empAddress: string, start = 0, end: number = Math.floor(Date.now() / 1000), currency: CurrencySymbol = "usd") => StatData[]

### emp/tvmHistoryBetween(empAddress: string, start = 0, end: number = Math.floor(Date.now() / 1000), currency: CurrencySymbol = "usd") => StatData[]

Returns TVL/TVM between timestamps (in seconds) at the highest resolution for a particular emp address.

### emp/tvlHistorySlice(empAddress: string, start = 0, length = 1, currency:CurrencySymbol='usd') => StatData[]

### emp/tvmHistorySlice(empAddress: string, start = 0, length = 1, currency:CurrencySymbol='usd') => StatData[]

Returns TVL/TVM for emp starting at timestamp in seconds and a length number of samples after that ascending.

### emp/listTvls(currency: CurrencySymbol = "usd") => Array<{value:string, timestamp:number}>

### emp/listTvms(currency: CurrencySymbol = "usd") => Array<{value:string, timestamp:number}>

List all tvls/tvms of known contracts.

### emp/historicalMarketPricesBetween(tokenAddress: string, start = 0, end: number = nowS()) StatData[]

Returns historical market prices (based on 0x api) for a token address. Get samples between a start time and end time ( in seconds).
Currently only usdc prices are supported.

### emp/sliceHistoricalMarketPrices(tokenAddress: string, start = 0, length = 1) StatData[]

Returns historical market prices (based on 0x api) for a token address. Slices from a starting timestamp (in seconds) and a count of samples newer than that.
Currently only usdc prices are supported.

### emp/globalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") => StatData[]

Gets the history of global tvl, the sum of all known EMP total value locked, between start and end timestamps in seconds.

### emp/globalTvlSlice(start = 0, length = 1, currency: CurrencySymbol = "usd") => StatData[]

Gets the history of global tvl, the sum of all known EMP total value locked, starting at start in timestamp seconds and counting length samples after that.

## LSP

Lsp calls are on the lsp channel. These calls are the same as the EMP calls, but just scoped to LSP contracts.

### lsp/actions() => string[]

### lsp/listAddresses() => string[]

### lsp/listActive() => LspState[]

### lsp/listExpired() => LspState[]

### lsp/getState(address: string) => LspState

### lsp/getErc20Info(address: string) => Erc20State

### lsp/allErc20Info() => Erc20State[]

### lsp/collateralAddresses() => String[]

### lsp/longAddresses() => String[]

### lsp/shortAddresses() => String[]

### lsp/listTvls(currency: CurrencySymbol = "usd") => Stat[]

### lsp/tvl(addresses: string[] = [], currency: CurrencySymbol = "usd") => Stat

### lsp/tvlHistoryBetween contractAddress: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") => Stat[]

### lsp/tvlHistorySlice(contractAddress: string, start = 0, length = 1, currency: CurrencySymbol = "usd") => Stat[]

### lsp/totalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") => Stat[]

### lsp/totalTvlSlice(start = 0, length = 1, currency: CurrencySymbol = "usd") => Stat[]

## Global

Global calls allow you to make calls without knowing the type of contract you are dealing with

### global/listActive()

List all active contracts, both LSP or EMP

### global/listExpired()

List all expired contracts, both LSP or EMP

### global/getState(address: string)

Get the state of a known contract address.

### global/globalTvl(currency: CurrencySymbol = "usd")

Global tvl, or the sum of tvls of all known contracts.

### global/tvl(address: string, currency: CurrencySymbol = "usd")

Look up tvl for any contract address.

### global/globalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd")

Global tvl history between times in seconds.

### global/tvlHistoryBetween(address: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd")

TVL history for a particular address.

### global/globalTvm(currency: CurrencySymbol = "usd")

Global tvm or the sum of all tvms of all known contracts.

### global/tvm(address: string, currency: CurrencySymbol = "usd")

TVM for a particular address.

### global/tvmHistoryBetween(address: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd")

TVM history for a specific address between timestamps in seconds.

### global/tvmHistorySlice(address: string, start = 0, length = 1, currency: CurrencySymbol = "usd")

TVM history slice for a specific address.
