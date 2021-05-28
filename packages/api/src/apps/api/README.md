# Uma Api App

This is the main application for ingesting data, formatting it and exposing it through restful endpoints.

## Environment

Add these to a .env file in the root of the api folder.

```
CUSTOM_NODE_URL=wss://mainnet.infura.io/ws/v3/${your project key}
EXPRESS_PORT=8282
UPDATE_BLOCKS=1 // defaults to 1: represents the number of block elapsed before rechecking contract states

```

## Starting

Assuming all dependencies are installed and `.env` is configured:
`npx ts-node src/start.ts api`

## Usage

All queries can be made to `http:localhost:${EXPRESS_PORT}` through a POST.
Example: `curl -X POST localhost:8282/actions` will list availabe actions

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
