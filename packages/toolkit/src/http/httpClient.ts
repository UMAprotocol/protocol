import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import Bottleneck from "bottleneck";
import axiosRetry from "axios-retry";

export interface RateLimitOptions {
  /** Max requests running in parallel (default = 5) */
  maxConcurrent?: number;
  /** Minimum gap in ms between jobs (default = 200 → ≈5 req/s) */
  minTime?: number;
}

export interface RetryOptions {
  /** How many attempts before we give up (default = 3) */
  retries?: number;
  /**
   * Predicate that decides if the error is retryable.
   * If omitted we retry on network errors, 429 and 5xx.
   */
  retryCondition?: (err: AxiosError) => boolean;
  /** First back-off delay (ms) before jitter (default = 100) */
  baseDelayMs?: number;
  /** Max jitter added to each back-off (default = 1000) */
  maxJitterMs?: number;
}

export interface HttpClientOptions {
  /** Standard Axios settings – baseURL, headers, timeout… */
  axios?: AxiosRequestConfig;
  /** Concurrency / throttle settings */
  rateLimit?: RateLimitOptions;
  /** Exponential-back-off settings */
  retry?: RetryOptions;
}

/**
 * Creates an Axios instance with rate limiting and retry capabilities
 * @param opts - Options for the HTTP client
 * @returns An Axios instance
 */
export function createHttpClient(opts: HttpClientOptions = {}): AxiosInstance {
  const { maxConcurrent = 5, minTime = 200 } = opts.rateLimit ?? {};
  const limiter = new Bottleneck({ maxConcurrent, minTime });

  const instance = axios.create({
    timeout: 10_000, // default timeout of 10 seconds
    ...opts.axios,
  });

  instance.interceptors.request.use((cfg) => limiter.schedule(async () => cfg));

  const { retries = 3, retryCondition, baseDelayMs = 100, maxJitterMs = 1000 } = opts.retry ?? {};

  axiosRetry(instance, {
    retries,
    retryCondition:
      retryCondition ??
      ((err) => {
        const st = err.response?.status ?? 0;
        return axiosRetry.isNetworkOrIdempotentRequestError(err) || st === 429 || st >= 500;
      }),
    retryDelay: (attempt, err) => {
      const base = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * maxJitterMs);
      const retryAfter = Number(err.response?.headers?.["retry-after"] ?? 0) * 1000;
      return retryAfter ? Math.max(retryAfter, base + jitter) : base + jitter;
    },
  });

  return instance;
}

export const http = createHttpClient();
