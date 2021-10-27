# Uma Serverless Read App

This is the application that exposes the Google Datastore application state through an Express server. It is designed to be lightweight and stateless.

## Environment

Add these to a .env file in the root of the `protocol/packages/api` folder.

```
EXPRESS_PORT=8282

# Provide authentication credentials to the api application to be able to use Google Datastore service (only on a local env)
GOOGLE_APPLICATION_CREDENTIALS=<path_to_json_file>

# any non null value will turn on debugging. This adds additional logs and time profiles for key calls.
debug=1
```

## Build

`yarn build`

## Starting

Assuming all dependencies are installed and `.env` is configured:

from package script:
`yarn serverless_read`

or directly:
`npx ts-node src/start.ts serverless_read`

## Usage

This app is almost identical to the regular API, but it comes without the services that write into the application state
See [api docs]('../api/README.md') for detailed usage of the endpoints.
