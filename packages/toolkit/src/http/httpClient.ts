import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import Bottleneck from "bottleneck";
import axiosRetry, { IAxiosRetryConfig } from "axios-retry";

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
  /**
   * Callback that is called when a request is retried.
   * This can be used to log the retry attempt.
   */
  onRetry?: (retryCount: number, err: AxiosError, config: AxiosRequestConfig) => void;
  /** Reset per-attempt timeout instead of using one global timer (default = false) */
  shouldResetTimeout?: boolean;
  /** First back-off delay (ms) before jitter (default = 100) */
  baseDelayMs?: number;
  /** Max jitter added to each back-off (default = 1000) */
  maxJitterMs?: number;
  /** Hard ceiling for the final delay (ms). Default = 10 000 ms */
  maxDelayMs?: number;
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

  const { retries = 3, retryCondition, onRetry, baseDelayMs = 100, maxJitterMs = 1000, maxDelayMs = 10_000 } =
    opts.retry ?? {};

  const retryCfg: IAxiosRetryConfig = {
    retries,
    shouldResetTimeout: opts.retry?.shouldResetTimeout ?? false,
    retryCondition:
      retryCondition ??
      ((err) => {
        const st = err.response?.status ?? 0;
        return axiosRetry.isNetworkOrIdempotentRequestError(err) || st === 429 || st >= 500;
      }),
    retryDelay: (attempt: number, err: AxiosError) => {
      const base = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * maxJitterMs);

      const h = err.response?.headers?.["retry-after"];
      let retryAfter = 0;

      if (h !== undefined) {
        if (/^\d+$/.test(h as string)) {
          // plain integer seconds
          retryAfter = Number(h) * 1000;
        } else {
          const parsed = Date.parse(h as string);
          if (!isNaN(parsed)) retryAfter = Math.max(parsed - Date.now(), 0);
        }
      }

      const delay = retryAfter || base + jitter;
      return Math.min(delay, maxDelayMs);
    },
  };

  if (typeof onRetry === "function") {
    retryCfg.onRetry = onRetry;
  }

  axiosRetry(instance, retryCfg);

  return instance;
}

export const http = createHttpClient();
