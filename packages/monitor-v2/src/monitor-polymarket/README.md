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

## Running the Polymarket Notifier Locally ⚙️

Follow these steps to run the Polymarket notifier on your local machine (outside serverless)

## 1. Clone the Required Repositories 📁

```bash
git clone https://github.com/UMAprotocol/bot-configs.git
git clone https://github.com/UMAprotocol/protocol.git
```

Set the paths:

```bash
export UMA_BOT_CONFIGS="/absolute/path/to/bot-configs"
export UMA_PROTOCOL="/absolute/path/to/protocol"
```

---

## 2. Install Dependencies (bot-configs) 📦

```bash
cd "$UMA_BOT_CONFIGS"
yarn install
```

---

## 3. Generate the .env File 🧪

```bash
node "$UMA_BOT_CONFIGS/scripts/print-env-file.js" \
  "$UMA_BOT_CONFIGS/serverless-bots/uma-config-5m.json" polymarket-polygon-notifier \
  | grep -Ev '^(SLACK_CONFIG|PAGER_DUTY_V2_CONFIG|DISCORD_CONFIG|DISCORD_TICKET_CONFIG|REDIS_URL|NODE_OPTIONS)=' \
  > "$UMA_PROTOCOL/packages/monitor-v2/src/monitor-polymarket/.env.local"; \
printf 'LOCAL_NO_DATASTORE=true\nNODE_OPTIONS=--max-old-space-size=16000\n' \
  >> "$UMA_PROTOCOL/packages/monitor-v2/src/monitor-polymarket/.env.local"
```

Then export the path:

```bash
export ENV_PATH="$UMA_PROTOCOL/packages/monitor-v2/src/monitor-polymarket/.env.local"
```

---

## 4. Build the monitor-v2 Package 🔧

```bash
cd "$UMA_PROTOCOL/packages/monitor-v2"
yarn install
yarn build
```

---

## 5. Run the Polymarket Notifier ▶️

```bash
DOTENV_CONFIG_PATH=$ENV_PATH DOTENV_CONFIG_OVERRIDE=true \
  node -r dotenv/config
```

### What to Expect When Running the Polymarket Notifier 👁️

When running the notifier locally, you will mainly see two types of logs:

### 1. Proposals aligned with market prices (no action needed) ✅

Example:

```bash
2025-11-27  10:54:44 [debug]: {
	"at":  "PolymarketMonitor",
	"message":  "Proposal Alignment Confirmed",
	"mrkdwn":  "A price of 0.0 corresponding to outcome 1 was proposed at 1764237601 for the following question: Solana Up or Down - November 27, 4AM ET. Market sentiment aligns with the proposed price. ✅ In the following transaction: <https://polygonscan.com/tx/0xd4ca8be277461863960fa57aecc43e9404f8a12d15b8c9b861452d83b9cffe11|0xd4c...cffe11> <https://oracle.uma.xyz/request?transactionHash=0xd4ca8be277461863960fa57aecc43e9404f8a12d15b8c9b861452d83b9cffe11&chainId=137&oracleType=OptimisticV2&eventIndex=7 | View in the Oracle UI.> AI check: <https://mcp-otb.vercel.app/results/10b342f2-0439-4168-b4f0-4509a8c396e0|View UMA AI review>.",
	"notificationPath":  "polymarket-notifier",
	"bot-identifier":  "NO_BOT_ID",
	"run-identifier":  "68130d70-66f0-45d9-9e20-523d8d22349c"
}
```

---

### 2.Proposals requiring manual review (potential dispute) 🚨

Example:

```bash

2025-11-27  10:54:44 [error]: {
	"at":  "PolymarketMonitor",
	"bot-identifier":  "polymarket-polygon-notifier",
	"level":  "error",
	"message":  "Difference between proposed price and market signal! 🚨",
	"mrkdwn":  "A price of 1.0 corresponding to outcome 0 was proposed at 1763677935 for the following question: Will Trump agree to a tariff agreement with Brazil by November 30?. In the following transaction: <https://polygonscan.com/tx/0x604aedeff5dd6997b7776b6fb3cfd4765f91a6756526b71a0740dee8527136d3|0x604...7136d3> Someone bought loser outcome tokens at a price above the threshold. These are the trades: [{\"price\":0.161,\"type\":\"buy\",\"timestamp\":1763682219,\"amount\":340.01},{\"price\":0.186,\"type\":\"buy\",\"timestamp\":1763682755,\"amount\":60},{\"price\":0.15,\"type\":\"buy\",\"timestamp\":1763683111,\"amount\":500}]. The proposal can be disputed until Fri, 21 Nov 2025 00:32:15 GMT. <https://oracle.uma.xyz/request?transactionHash=0x604aedeff5dd6997b7776b6fb3cfd4765f91a6756526b71a0740dee8527136d3&chainId=137&oracleType=OptimisticV2&eventIndex=917 | View in the Oracle UI.> Please check the market proposal and dispute if necessary. AI check: <https://mcp-otb.vercel.app/results/10b342f2-0439-4168-b4f0-4509a8c396e0|View UMA AI review>.",
	"notificationPath":  "polymarket-notifier",
	"run-identifier":  "85130425-698b-470c-a881-23619679779c",
	"timestamp":  "2025-11-21T00:11:06.267Z"
}

```

**ACTION ⚠️:**
First, open the **AI check link** in the log (`AI check: <…|View UMA AI review>`). This is your first line of defense and provides a quick assessment of whether the proposal aligns with market conditions.

- If the AI marks the proposal as **Unclear** or **Disagrees**, immediately open the Oracle UI link (e.g. `https://oracle.uma.xyz/request?...`) to manually review the proposal.
- After checking the market data yourself, if you confirm that the proposed price looks incorrect, be ready to **dispute the proposal before the deadline**.
