# Uma Api

This package is meant to ingest and expose data about the UMA ecosystem through a restful API.

## Apps

- [api](./apps/api): entry point to run all the api logic
- [lsp_api](./apps/lsp_api): entry point to run all the api logic
- [datastore_api](./apps/datastore_api): entry point to run all the api logic

## Libraries

- [libs](./libs) - various supporting libraries
- [services](./services) - microservice style components
- [tables](./tables) - data tables for storing api related data
- [examples](./examples) - various frontend tools

### ENV

You will need a .env for each application. See the specific application readme.

## Quickstart

There maybe 1 or more available apps in the `src/apps` folder. To start the `api` app:

Install dependencies: `yarn`

To run `api`:

1. `yarn build`
2. `yarn api`
