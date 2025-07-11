# `@uma/toolkit`

Shared, framework‑agnostic helpers that we reuse across Risk Lab's TypeScript codebases.

The first module shipping here is a **rate‑limited, retry‑friendly HTTP client** built on **Axios + Bottleneck + axios‑retry**—perfect for hitting third‑party APIs without blowing through their quotas.

---

## Installation

```
# inside any workspace in the monorepo
yarn lerna add @uma/toolkit --scope @uma/monitor-v2
```

> **External project?** > `yarn add @uma/toolkit` once it’s published to npm.

---

## Quick start

```ts
import { http } from "@uma/toolkit/http"

const { data } = await http.get("https://example.com/api/v1/status")
```

**Defaults**

- max 5 concurrent requests
- ≥ 200 ms gap → ≈ 5 req/s
- timeout 10 s
- 3 retries on network errors, 5xx or 429 with exponential back‑off + jitter

---

## Custom client per service

```ts
import { createHttpClient } from "@uma/toolkit/http"

const exampleAPI = createHttpClient({
  axios: { baseURL: "https://example.com" },
  rateLimit: { maxConcurrent: 1, minTime: 1200 },
  retry: { retries: 5 },
})

await exampleAPI.post("/api/v1/update", payload)
```

Every instance has its own **Bottleneck** limiter and **axios‑retry** strategy, so different services can run with different quotas.

---

### Options reference

| Option                      | Default             | Notes                               |
| --------------------------- | ------------------- | ----------------------------------- |
| `axios.baseURL`             | `""`                | Standard Axios config               |
| `axios.timeout`             | `10 000`            | ms                                  |
| `rateLimit.maxConcurrent`   | `5`                 | Parallel inflight cap               |
| `rateLimit.minTime`         | `200`               | ms gap between jobs                 |
| `retry.retries`             | `3`                 | Total attempts = 1 + retries        |
| `retry.baseDelayMs`         | `100`               | First back‑off step                 |
| `retry.maxJitterMs`         | `1000`              | Randomised to avoid thundering herd |
| `retry.retryCondition(err)` | network / 5xx / 429 | Override for fine‑grained control   |

---
