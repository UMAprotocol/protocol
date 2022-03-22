import Web3 from "web3";
import assert from "assert";

type Web3ProviderOptions =
  | ConstructorParameters<typeof Web3.providers.HttpProvider>[1]
  | ConstructorParameters<typeof Web3.providers.WebsocketProvider>[1];

type Web3Provider =
  | InstanceType<typeof Web3.providers.HttpProvider>
  | InstanceType<typeof Web3.providers.WebsocketProvider>;

interface Config {
  retries: number;
  delay: number;
  url: string;
  options?: Web3ProviderOptions;
}

type PartialExcept<T, K extends keyof T> = Partial<Omit<T, K>> & Pick<T, K>;
type Payload = Parameters<Web3Provider["send"]>[0];
type Callback = Parameters<Web3Provider["send"]>[1];
type CallbackResult = Parameters<Callback>[1];

export type RetryConfig = PartialExcept<Config, "url">;

// Wraps one or more web3 http/websocket providers and allows per-request retries and fallbacks.
export class RetryProvider {
  private providerCaches: (Config & { provider?: Web3Provider })[];

  /**
   * @notice Constructs new retry provider.
   * @param {Array} config config object:
   *   [
   *      {
   *        retries: 3,
   *        delay: 1
   *        url: https://mainnet.infura.io/v3/ACCOUNT_ID,
   *        options: {
   *          timeout: 15000
   *        }
   *      },
   *      {
   *        retries: 5,
   *        delay: 1,
   *        url: ws://99.999.99.99
   *      }
   *   ]
   */
  constructor(configs: RetryConfig[]) {
    assert(configs.length > 0, "Must have at least one provider");
    this.providerCaches = configs.map((config) => ({ retries: 1, delay: 0, ...config }));
  }

  // Passes the send through, catches errors, and retries on error.
  sendAsync(payload: Payload, callback: Callback): void {
    this.send(payload, callback);
  }

  // Passes the send through, catches errors, and retries on error.
  send(payload: Payload, callback: Callback): void {
    // Turn callback into async-await internally.
    const sendWithProvider = (provider: Web3Provider): Promise<CallbackResult> => {
      return new Promise((resolve, reject) => {
        provider.send(payload, (error, result) => {
          if (error) {
            // Error thrown in the provider.
            reject(error);
          } else if (result?.error) {
            // Error object returned from node.
            // TODO: we may need to add additional logic to discern EVM execution errors from node connection errors.
            reject(result);
          } else {
            resolve(result);
          }
        });
      });
    };

    // Turn retry promise result back into a callback.
    this._runRetry(sendWithProvider).then(
      (result) => callback(null, result),
      (reason) => callback(reason, undefined)
    );
  }

  // Pass through disconnect to any initialized providers.
  disconnect(code: number, reason: string): void {
    for (const cache of this.providerCaches) {
      cache?.provider?.disconnect(code, reason);
    }
  }

  supportsSubscriptions(): boolean {
    return false; // return false for simplicity since some providers may be http, which doesn't support subscriptions.
  }

  _constructOrGetProvider(index: number): Web3Provider {
    const cache = this.providerCaches[index];
    assert(cache, "No provider for this index");
    if (!cache.provider) {
      const { url, options } = cache;
      cache.provider = url.startsWith("ws")
        ? new Web3.providers.WebsocketProvider(url, options)
        : new Web3.providers.HttpProvider(url, options);
    }
    return cache.provider;
  }

  // Returns a Promise that resolves to the wrapped provider.
  async _runRetry<T>(
    fn: (provider: Web3Provider) => Promise<T>,
    providerIndex = 0,
    retryIndex = 0,
    previousErrors: Error[] = []
  ): Promise<T> {
    const provider = this._constructOrGetProvider(providerIndex);
    try {
      return await fn(provider);
    } catch (error: any) {
      const { delay, retries } = this.providerCaches[providerIndex];
      // If out of retries, move to next provider.
      const shouldMoveToNextProvider = retries <= retryIndex + 1;
      const nextRetryIndex = shouldMoveToNextProvider ? 0 : retryIndex + 1;
      const nextProviderIndex = shouldMoveToNextProvider ? providerIndex + 1 : providerIndex;
      const errors = shouldMoveToNextProvider ? [...previousErrors, error] : previousErrors;

      // If this is the last provider, concatenate all errors and throw them.
      if (nextProviderIndex >= this.providerCaches.length)
        throw new Error(
          `Multiple Errors: \n${errors
            .map(
              (error: Error, index) =>
                `Provider ${index} at ${this.providerCaches[index]?.url || "unknown"}: ${
                  error.stack || error.message || JSON.stringify(error)
                }`
            )
            .join("\n\n")}`
        ); // No more providers to try.
      if (!shouldMoveToNextProvider) await new Promise((resolve) => setTimeout(resolve, delay * 1000)); // Delay only if not moving to a new provider.

      // Run function again with a different provider or retry index.
      return await this._runRetry(fn, nextProviderIndex, nextRetryIndex, errors);
    }
  }
}
