# Polymarket Notifier

This app continuously monitors UMA Optimistic Oracle contract proposals and sends notifications based on Polymarket API information.

The Polymarket notifier looks for ProposePrice events related to the Polymarket contracts and uses the Polymarket API to fetch all active contract market prices. It compares proposed prices against the Polymarket API and notifies the user through a logging mechanism that can forward an alert to Slack or any other configured transport mechanism. Notified proposals are stored on Google Datastore, so on repeated runs the application does not notify the same proposal.

The main entry point to Polymarket notifier bot is running:

```
node ./packages/monitor-v2/dist/monitor-polymarket/index.js
```

All the configuration should be provided with following environment variables:

- `CHAIN_ID` is network number.
- `NODE_URLS_X` is an array of RPC node URLs replacing `X` in variable name with network number from `CHAIN_ID`.
- `NODE_URL_X` is a single RPC node URL replacing `X` in variable name with network number from `CHAIN_ID`.
  considered only if matching `NODE_URLS_X` is not provided.
- `NODE_RETRIES` is the number of retries to make when a node request fails (defaults to `2`).
- `NODE_RETRY_DELAY` is the delay in seconds between retries (defaults to `1`).
- `NODE_TIMEOUT` is the timeout in seconds for node requests (defaults to `60`).
- `POLLING_DELAY` is value in seconds for delay between consecutive runs, defaults to 1 minute. If set to 0 then running in serverless mode will exit after the loop.
  in serverless mode will exit after the loop.
- `THRESHOLD_ASKS` Price threshold for winner outcome asks in the orderbook that triggers a notification (defaults to `1`).
- `THRESHOLD_BIDS` Price threshold for loser outcome bids in the orderbook that triggers a notification (defaults to `0`).
- `THRESHOLD_VOLUME` Volume threshold for the market that triggers a notification (defaults to `500000`).
- `UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL` is the interval in seconds we allow to pass before notifying about a proposal event not found (defaults to `300`).
- `RETRY_ATTEMPTS` optionally specify a number to retry various external queries to polymarket. Defaults to off.
- `RETRY_DELAY_MS` optionally specify a delay in milliseconds between retries, defaults to 0 delay.
- `FILL_EVENTS_LOOKBACK_SECONDS` controls how many seconds of historic fills to consider for each proposal (defaults to `1800`).
- `FILL_EVENTS_PROPOSAL_GAP_SECONDS` adds a positive buffer after the proposal block before fills are queried, ensuring we skip fills close to proposal timestamp (defaults to `300`).


## Running the Polymarket Notifier Locally

To run the Polymarket notifier on your local machine (outside serverless), follow these steps:

### 1. Clone the required repositories

If you haven’t already:

- Bot configs: https://github.com/UMAprotocol/bot-configs
- Protocol: https://github.com/UMAprotocol/protocol

From any folder where you keep your projects, run:

```bash
    git clone https://github.com/UMAprotocol/bot-configs.git
    git clone https://github.com/UMAprotocol/protocol.git
```
---

### 2. Generate the `.env` file (inside the bot-configs repo)

From the **root** of the `bot-configs` repository, run:

```bash
  node ./scripts/print-env-file.js ./serverless-bots/uma-config-5m.json polymarket-polygon-notifier \
    | grep -Ev '^(SLACK_CONFIG|PAGER_DUTY_V2_CONFIG|DISCORD_CONFIG|DISCORD_TICKET_CONFIG|REDIS_URL|NODE_OPTIONS)=' \
    > .env; printf 'LOCAL_NO_DATASTORE=true\nNODE_OPTIONS=--max-old-space-size=16000\n' >> .env
```

This command:

- Prints the full environment configuration for the `polymarket-polygon-notifier`
- Removes unnecessary configs (Slack, PagerDuty, Discord, Redis)
- Appends:
  - `LOCAL_NO_DATASTORE=true` → run without Google Cloud Datastore  
  - `NODE_OPTIONS=--max-old-space-size=16000` → increase Node memory

Now copy the absolute path of the generated `.env` file, e.g.:

    export ENV_PATH=$HOME/UMAprotocol/bot-configs/.env

---

### 3. Build the Protocol monitor package

Navigate to the `monitor-v2` package in the **protocol** repository:

    cd $HOME/UMAprotocol/protocol/packages/monitor-v2
    yarn install
    yarn build

---

### 4. Run the Polymarket notifier

From the same `monitor-v2` directory, run the notifier pointing to the generated `.env` file:

    DOTENV_CONFIG_PATH=$ENV_PATH \
      node -r dotenv/config ./dist/monitor-polymarket/index.js

This will run the Polymarket notifier locally and print results to the console.
## What to Expect When Running the Polymarket Notifier

When running the notifier locally, you will mainly see two types of logs:

---

### 1. Proposals aligned with market prices (no action needed)

Example:

```bash
2025-11-27 10:54:44 [debug]: {
  "at": "PolymarketMonitor",
  "message": "Proposal Alignment Confirmed",
  "mrkdwn": "A price of 0.0 corresponding to outcome 1 was proposed at 1764237601 for the following question:  Solana Up or Down - November 27, 4AM ET. Market sentiment aligns with the proposed price. ✅ In the following transaction: <https://polygonscan.com/tx/0xd4ca8be277461863960fa57aecc43e9404f8a12d15b8c9b861452d83b9cffe11|0xd4c...cffe11> <https://oracle.uma.xyz/request?transactionHash=0xd4ca8be277461863960fa57aecc43e9404f8a12d15b8c9b861452d83b9cffe11&chainId=137&oracleType=OptimisticV2&eventIndex=7 | View in the Oracle UI.>",
  "notificationPath": "polymarket-notifier",
  "bot-identifier": "NO_BOT_ID",
  "run-identifier": "68130d70-66f0-45d9-9e20-523d8d22349c"
}
```

---

### 2. Proposals requiring manual review (potential dispute)

Example:

```bash
2025-11-27 10:54:44 [error]: {
  "at": "PolymarketMonitor",
  "bot-identifier": "polymarket-polygon-notifier",
  "level": "error",
  "message": "Difference between proposed price and market signal! 🚨",
  "mrkdwn": "A price of 1.0 corresponding to outcome 0 was proposed at 1763677935 for the following question:  Will Trump agree to a tariff agreement with Brazil by November 30?. In the following transaction: <https://polygonscan.com/tx/0x604aedeff5dd6997b7776b6fb3cfd4765f91a6756526b71a0740dee8527136d3|0x604...7136d3> Someone bought loser outcome tokens at a price above the threshold. These are the trades: [{\"price\":0.161,\"type\":\"buy\",\"timestamp\":1763682219,\"amount\":340.01},{\"price\":0.186,\"type\":\"buy\",\"timestamp\":1763682755,\"amount\":60},{\"price\":0.15,\"type\":\"buy\",\"timestamp\":1763683111,\"amount\":500}]. The proposal can be disputed until Fri, 21 Nov 2025 00:32:15 GMT. <https://oracle.uma.xyz/request?transactionHash=0x604aedeff5dd6997b7776b6fb3cfd4765f91a6756526b71a0740dee8527136d3&chainId=137&oracleType=OptimisticV2&eventIndex=917 | View in the Oracle UI.> Please check the market proposal and dispute if necessary.",
  "notificationPath": "polymarket-notifier",
  "run-identifier": "85130425-698b-470c-a881-23619679779c",
  "timestamp": "2025-11-21T00:11:06.267Z"
}
```

**ACTION**: Use the link provided in the log (e.g. https://oracle.uma.xyz/request?transactionHash=0x604aedeff5dd6997b7776b6fb3cfd4765f91a6756526b71a0740dee8527136d3&chainId=137&oracleType=OptimisticV2&eventIndex=917) to open the Oracle UI and review the proposal for potential dispute.