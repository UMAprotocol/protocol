# Uma API App

This is the main application for ingesting data, formatting it and exposing it through restful endpoints.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282
UPDATE_BLOCKS=1 // defaults to 1: represents the number of block elapsed before rechecking contract states
OLDEST_BLOCK_MS=1 // defaults to 864,000,000 ( 10 days): represents the max age a block will stay cached

# these configure synthetic price feed. These price feeds may require paid api keys.
cryptowatchApiKey=
tradermadeApiKey=
quandlApiKey=
defipulseApiKey=
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

### collateralAddresses() => string[]

### syntheticAddresses() => string[]

Returns all known active collateral or synthetic addresses

### allLatestPrices(currency='usd') => {[address:string]:[timestamp:number,price:string]}

Returns all known latest prices for collateral addresses. Synthetic prices not yet available.

### latestPriceByAddress(address:string,currency:'usd') => [timestamp:number,price:string]}

Returns latest price for a particular collateral address.

### historicalPricesByAddress(address:string,start:number=0,end:number=Math.floor(Date.now() / 1000),currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and end in seconds, sorted by timestamp ascending from an erc20 token address.
This is useful for charting betwen two dates.

### sliceHistoricalPricesByAddress(address:string,start:number=0,length:number=1,currency:"usd"="usd") => PriceSample[]

Get a range of historical prices between start and count of price samples, sorted by timestamp ascending, from an erc20 token address.
This is useful for paginating data when you have X elements per page, and you know the last element seen.

### getErc20Info(address:string) => Erc20Data

Get name, decimals of an erc20 by address.

### getAllErc20Info() => Erc20Data[]

List all known erc20s, collateral or synthetic and all known information about them

### allLatestSynthPrices => {[empAddress:string]:[timestamp:number,price:string]}

Returns all known latest synthetic prices based on emp address. This differs from collateral price requests, as
that call uses the collateral address, not the emp address.

### latestSynthPriceByAddress(empAddress:string,currency:'usd') => [timestamp:number,price:string]}

Returns latest synthetic price for an emp address. This differs from collateral price requests, as
that call uses the collateral address, not the emp address.

### getEmpStats(address: string, currency: "usd" = "usd") => StatData

Get only tvl (and other future statistics) for a single emp.

### listEmpStats(currency: "usd" = "usd") => StatData[]

Get all tvl (and other future statistics) for all known emps.

### historicalSynthPricesByAddress(empAddress:string,start:number=0,end:number=Math.floor(Date.now() / 1000)) => PriceSample[]

Get a range of historical prices synthetic prices by emp address between start and end in unix seconds, sorted by timestamp
ascending. This is useful for charting betwen two dates. Note non synth historical prices are specified by erc20 address.

### sliceHistoricalSynthPricesByAddress(address:string,start:number=0,length:number=1) => PriceSample[]

Get a range of historical synthetic prices by emp address between start (in unix seconds) and count of price samples, sorted by timestamp
ascending. This is useful for paginating data when you have X elements per page, and you know the last element seen.
Note non synth historical prices are specified by erc20 address.

### tvl(addresses?: string[], currency: CurrencySymbol = "usd") => string

Returns tvl of all supplied addresses in USD 18 decimals. If no addresses supplied, returns TVL of all known contracts.

### getEmpStatsBetween(address: string, start = 0, end: number = Math.floor(Date.now() / 1000), currency: CurrencySymbol = "usd") => StatData[]

Returns all stats between timestamps (in seconds) at the highest resolution for a particular emp address.
