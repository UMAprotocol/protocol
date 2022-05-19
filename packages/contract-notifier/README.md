# UMA Contracts Notifier

This app continuously monitors UMA financial contracts and sends notifications based on predefined conditions. Currently the app implements only expiration notifications on EMP and LSP contracts..

## Contract expiration notifier

Contract notifier uses UMA API to fetch all known financial contracts, filters soon to expire contracts and notifies them through logging mechanism that can forward it to Slack or any other configured transport mechanism. Notified contracts are stored on Google Datastore, so on repeated runs the application does not notify the same contracts.

### Environment variables

The expiring contracts notifier uses following environment variables:

- `NOTIFIER_CONFIG` is a JSON object containing application specific parameters:
  - `maxTimeTillExpiration` is maximum time in seconds till expiration for the contract to be included in the notification, defaulting to 1 week.
  - `chainId` indicates on which chain the monitored contracts are deployed, defaulting to 1 (Ethereum Mainnet).
  - `apiEndpoint` sets API to fetch contract information, defaulting to https://prod.api.umaproject.org. As each API endpoint serves its own network this parameter should be consistent with `chainId` above.
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1h. If set to 0 then running in serverless mode will exit after the loop.
- `BOT_IDENTIFIER` identifies the application name in the logs.
- `ERROR_RETRIES` is number of times to retry failed operation (e.g. due to API not responding). It defaults to 3 re-tries on error within the execution loop.
- `ERROR_RETRIES_TIMEOUT` is time in seconds between re-tries, defaulting to 1 second.
- `SLACK_CONFIG` is a JSON object containing `defaultWebHookUrl` for the default Slack webhook URL and `escalationPathWebhookUrls` being an object with webhook URLs for particular Slack channel routing.
- `GOOGLE_APPLICATION_CREDENTIALS` points to Google Cloud Platform service account key file to access Google Datastore. This is only required when running the application locally.

### Running expiring contracts notifier

From UMA [protocol repository](https://github.com/UMAprotocol/protocol/) run:

```
yarn contract-notifier --network mainnet_mnemonic
```
