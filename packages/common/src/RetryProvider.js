const assert = require("assert");
const Web3 = require("web3");

// Wraps one or more web3 http/websocket providers and allows per-request retries and fallbacks.
class RetryProvider {
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
  constructor(configs) {
    assert(configs.length > 0, "Must have at least one provider");
    this.providerCaches = configs.map(config => ({
      retries: 1,
      delay: 0,
      ...config
    }));
  }

  // Passes the send through, catches errors, and retries on error.
  send(payload, callback) {
    // Turn callback into async-await internally.
    const sendWithProvider = provider => {
      return new Promise((resolve, reject) => {
        provider.send(payload, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
    };

    // Turn retry promise result back into a callback.
    this._runRetry(sendWithProvider).then(
      result => callback(null, result),
      reason => callback(reason, null)
    );
  }

  // Pass through disconnect to any initialized providers.
  disconnect(...all) {
    for (const cache of this.providerCaches) {
      cache?.provider.disconnect(...all);
    }
  }

  supportsSubscriptions() {
    return false; // return false for simplicity since some providers may be http, which doesn't support subscriptions.
  }

  _constructOrGetProvider(index) {
    const cache = this.providerCaches[index];
    require(cache, "No provider for this index");
    if (!cache.provider) {
      const { url, options } = cache;
      cache.provider = url.startsWith("ws")
        ? new Web3.providers.WebsocketProvider(url, options)
        : new Web3.providers.HttpProvider(url, options);
    }
    return cache.provider;
  }

  // Returns a Promise that resolves to the wrapped provider.
  async _runRetry(fn, providerIndex = 0, retryIndex = 0) {
    const provider = this._constructOrGetProvider(providerIndex);
    try {
      return await fn(provider);
    } catch (error) {
      let nextRetryIndex = retryIndex + 1;
      let nextProviderIndex = providerIndex;
      if (this.providerCaches[providerIndex].retries === nextRetryIndex) {
        nextRetryIndex = 0;
        nextProviderIndex = providerIndex + 1;
        if (nextProviderIndex >= this.providerCaches.length) throw error; // No more providers to try.
      }

      return await this._runRetry(fn, nextProviderIndex, nextRetryIndex);
    }
  }
}

module.exports = { RetryProvider };
