# Uma API App

This is the main application for ingesting data, formatting it and exposing it through restful endpoints.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282

# defaults to 1: represents the number of block elapsed before rechecking contract states
UPDATE_BLOCKS=1

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

### actions() => string[]

Returns a list of all actions

### echo(...args:Json[]) => args

Echos back any parameters you send to the server. For testing connectivity and client correctness.

### listEmpAddresses() => string[]

Returns all known emp addresses for this servers network, which defaults to mainnet.

### lastBlock() => number

Returns the last block number seen.

### listActiveEmps() => Emps[]

Returns all known active emps data. Conforms to the EMP type defined in the uma sdk: `uma.tables.emp.Data`.

### listExpiredEmps() => Emps[]

Returns all known expired emps data. Conforms to the EMP type defined in the uma sdk: `uma.tables.emp.Data`.

### getEmpState(address: string) => EmpState

Get all known state of any emp by its address.

### getErc20Info(address:string) => Erc20Data

Get name, decimals of an erc20 by address.

### getAllErc20Info() => Erc20Data[]

List all known erc20s, collateral or synthetic and all known information about them

### collateralAddresses() => string[]

### syntheticAddresses() => string[]

Returns all known active collateral or synthetic addresses

### allLatestPrices(currency='usd') => {[address:string]:[timestamp:number,price:string]

Returns all known latest prices for synthetic or collateral addresses in wei.

### allLatestMarketPrices() => {[address:string]:[timestamp:number,price:string]

Returns all latest known market prices (based on matcha/0x routing) for synthetic or collateral addresses in wei.

### latestPriceByTokenAddress(tokenAddress:string,currency:'usd') => [timestamp:number,price:string]

Returns latest price for a particular erc20 token address ( emp collateral or synthetic address) in wei.

### latestSyntheticPrice(empAddress: string, currency: CurrencySymbol = "usd") => [timestamp:number,price:string]

### latestCollateralPrice(empAddress: string, currency: CurrencySymbol = "usd") => [timestamp:number,price:string]

Gets the latest collateral or synthetic price based on the emp contract address in wei.

### historicalPricesByTokenAddress(tokenAddress:string,start:number=0,end:number=Date.now(),currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and end in MS, sorted by timestamp ascending from an erc20 token address in wei.
This is useful for charting betwen two dates.

### sliceHistoricalPricesByTokenAddress(tokenAddress:string,start:number=0,length:number=1,currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and count of price samples, sorted by timestamp ascending, from an erc20 token address.
This is useful for paginating data when you have X elements per page, and you know the last element seen.

### async historicalSynthPrices( empAddress: string, start = 0, end: number = Date.now()) => PriceSample[]

### async historicalCollateralPrices( empAddress: string, start = 0, end: number = Date.now()) => PriceSample[]

Get a range of historical prices between start and end in MS, sorted by timestamp ascending from an emp contract address.
This is useful for charting betwen two dates.

### async sliceHistoricalSynthPrices(empAddress: string, start = 0, length = 1) => PriceSample[]

### async sliceHistoricalCollateralPrices(empAddress: string, start = 0, length = 1) => PriceSample[]

Get a range of historical prices between start and count of price samples, sorted by timestamp ascending, from an emp contract address.
This is useful for paginating data when you have X elements per page, and you know the last element seen.

### tvl(empAddresses?: string[], currency: CurrencySymbol = "usd") => string

### tvm(empAddresses?: string[], currency: CurrencySymbol = "usd") => string

Returns TVL/TVM of all supplied addresses in USD 18 decimals. If no addresses supplied, returns TVL/TVM of all known contracts.

### tvlHistoryBetween(empAddress: string, start = 0, end: number = Math.floor(Date.now() / 1000), currency: CurrencySymbol = "usd") => StatData[]

### tvmHistoryBetween(empAddress: string, start = 0, end: number = Math.floor(Date.now() / 1000), currency: CurrencySymbol = "usd") => StatData[]

Returns TVL/TVM between timestamps (in seconds) at the highest resolution for a particular emp address.

### tvlHistorySlice(empAddress: string, start = 0, length = 1, currency:CurrencySymbol='usd') => StatData[]

### tvmHistorySlice(empAddress: string, start = 0, length = 1, currency:CurrencySymbol='usd') => StatData[]

Returns TVL/TVM for emp starting at timestamp in seconds and a length number of samples after that ascending.

### listTvls(currency: CurrencySymbol = "usd") => Array<{value:string, timestamp:number}>

### listTvms(currency: CurrencySymbol = "usd") => Array<{value:string, timestamp:number}>

List all tvls/tvms of known contracts.

### historicalMarketPricesBetween(tokenAddress: string, start = 0, end: number = nowS()) StatData[]

Returns historical market prices (based on 0x api) for a token address. Get samples between a start time and end time ( in seconds).
Currently only usdc prices are supported.

### sliceHistoricalMarketPrices(tokenAddress: string, start = 0, length = 1) StatData[]

Returns historical market prices (based on 0x api) for a token address. Slices from a starting timestamp (in seconds) and a count of samples newer than that.
Currently only usdc prices are supported.

### globalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") => StatData[]

Gets the history of global tvl, the sum of all known EMP total value locked, between start and end timestamps in seconds.

### globalTvlSlice(start = 0, length = 1, currency: CurrencySymbol = "usd") => StatData[]

Gets the history of global tvl, the sum of all known EMP tottal value locked, starting at start in timestamp seconds and counting length samples after that.
