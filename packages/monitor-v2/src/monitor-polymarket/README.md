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

    $HOME/UMAprotocol/bot-configs/.env

---

### 3. Build the Protocol monitor package

Navigate to the `monitor-v2` package in the **protocol** repository:

    cd $HOME/UMAprotocol/protocol/packages/monitor-v2
    yarn install
    yarn build

---

### 4. Run the Polymarket notifier

From the same `monitor-v2` directory, run the notifier pointing to the generated `.env` file:

    DOTENV_CONFIG_PATH=$HOME/UMAprotocol/bot-configs/.env \
      node -r dotenv/config ./dist/monitor-polymarket/index.js

This will run the Polymarket notifier locally and print results to the console.