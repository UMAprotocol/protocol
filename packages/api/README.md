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
```

### Development

- API:
  ```
  yarn workspace @uma/api dev
  ```

- Worker:
  ```
  yarn workspace @uma/api worker
  ```

### Notes

- The worker enforces one ticket per `RATE_LIMIT_SECONDS` to respect Ticket Tool limits.
- `DISCORD_CHANNEL_ID` is configured via environment variable and determines where tickets are posted.
