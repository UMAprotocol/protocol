## UMA Ticketing API

Fastify + BullMQ API to enqueue Discord Ticket Tool messages. Credentials are provided via environment variables; no secrets are accepted via HTTP.

### Endpoints

- POST `/tickets`

  - Body:
    - `title` (string, required)
    - `content` (string, required)
  - Response: `202 Accepted` with `{ "jobId": "<string>" }`

- GET `/health` — returns `{ ok: true }`

### Environment

Copy `.env.example` to `.env` and fill the values:

```
PORT=8080
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=123456789012345678
QUEUE_NAME=discord-ticket-queue
RATE_LIMIT_SECONDS=20
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_TLS=false
WORKER_MODE=daemon
WORKER_JOB_IDLE_GRACE_SECONDS=30
WORKER_JOB_CHECK_INTERVAL_SECONDS=5
# WORKER_JOB_MAX_RUNTIME_SECONDS=900
```

### Development

- API:

  ```
  yarn workspace @uma/discord-ticket-api dev
  ```

- Worker:
  ```
  yarn workspace @uma/discord-ticket-api worker
  ```

### Notes

- The worker enforces one ticket per `RATE_LIMIT_SECONDS` to respect Ticket Tool limits.
- `DISCORD_CHANNEL_ID` is configured via environment variable and determines where tickets are posted.
- Worker modes:
  - `WORKER_MODE=daemon` (default) runs indefinitely, suitable for VMs/containers with a long-lived process manager.
  - `WORKER_MODE=job` is Cloud Run–friendly; the worker exits once the queue has been idle for `WORKER_JOB_IDLE_GRACE_SECONDS` (checked every `WORKER_JOB_CHECK_INTERVAL_SECONDS`) or when `WORKER_JOB_MAX_RUNTIME_SECONDS` is reached (if set). Example: `WORKER_MODE=job WORKER_JOB_IDLE_GRACE_SECONDS=30 WORKER_JOB_CHECK_INTERVAL_SECONDS=5 WORKER_JOB_MAX_RUNTIME_SECONDS=900 node dist/worker.js`.

### Docker (root image)

The root `Dockerfile` builds the whole repo and uses `scripts/runCommand.sh` to execute whatever you pass in `COMMAND`.

- API: `docker run --rm -p 8080:8080 --env-file .env -e COMMAND="yarn workspace @uma/discord-ticket-api start" umaprotocol/protocol`
- Worker (daemon): `docker run --rm --env-file .env -e COMMAND="yarn workspace @uma/discord-ticket-api start:worker" umaprotocol/protocol`
- Worker (job/Cloud Run): add worker-mode envs, e.g. `docker run --rm --env-file .env -e WORKER_MODE=job -e WORKER_JOB_IDLE_GRACE_SECONDS=30 -e WORKER_JOB_CHECK_INTERVAL_SECONDS=5 -e WORKER_JOB_MAX_RUNTIME_SECONDS=900 -e COMMAND="yarn workspace @uma/discord-ticket-api start:worker" umaprotocol/protocol`

```

```
