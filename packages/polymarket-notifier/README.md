# Polymarket Notifier

This app continuously monitors UMA Optimistic Oracle contract proposals and sends notifications based on Polymarket API information.

The Polymarket notifier looks for ProposePrice events related to the Polymarket contracts and uses the Polymarket API to fetch all active contract market prices. It compares proposed prices against the Polymarket API and notifies the user through a logging mechanism that can forward an alert to Slack or any other configured transport mechanism. Notified proposals are stored on Google Datastore, so on repeated runs the application does not notify the same proposal.

### Environment variables

The Polymarket notifier uses the following environment variables:

- `NOTIFIER_CONFIG` is a JSON object containing-application specific parameters:
  - `maxTimeAfterProposal` is the maximum time in seconds after the proposal timestamp for the contract to be included in the notification. This should be set based on the liveness period for Polymarket contracts.
  - `apiEndpoint` sets API to fetch Polymarket contract information, defaulting to https://strapi-matic.poly.market/markets
- `POLLING_DELAY` is value in seconds for the delay between consecutive runs, defaults to 10 minutes. If set to 0 then running in serverless mode will exit after the loop.
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `ERROR_RETRIES` is the number of times to retry failed operation (e.g. due to API not responding). It defaults to 3 re-tries on error within the execution loop.
- `ERROR_RETRIES_TIMEOUT` is time in seconds between re-tries, defaulting to 1 second.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL and `escalationPathWebhookUrls` being an object with webhook URLs for particular Slack channel routing.
- `GOOGLE_APPLICATION_CREDENTIALS` points to Google Cloud Platform service account key file to access Google Datastore. This is only required when running the application locally.

### Running expiring contracts notifier

The simplest way to run the Polymarket monitor bot is from UMA [protocol repository](https://github.com/UMAprotocol/protocol/) run (if running locally, make sure you have `GOOGLE_APPLICATION_CREDENTIALS` as an environment variable):

```
CUSTOM_NODE_URL=https://your.node.url.io yarn polymarket-notifier
```
