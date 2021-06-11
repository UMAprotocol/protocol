# Uma API App

This is the main application for ingesting data, formatting it and exposing it through restful endpoints.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282
UPDATE_BLOCKS=1 // defaults to 1: represents the number of block elapsed before rechecking contract states
OLDEST_BLOCK_MS=1 // defaults to 864,000,000 ( 10 days): represents the max age a block will stay cached
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
