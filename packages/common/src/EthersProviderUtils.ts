import { ethers } from "ethers";

const defaultTimeout = 60 * 1000;

function delay(s: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.round(s * 1000)));
}

// This provider class is used to retry requests to a list of providers in order.
// This class is not exported as it is only used internally from getRetryProvider that validates constructor parameters.
class EthersRetryProvider extends ethers.providers.StaticJsonRpcProvider {
  readonly providers: ethers.providers.StaticJsonRpcProvider[];
  constructor(
    params: ConstructorParameters<typeof ethers.providers.StaticJsonRpcProvider>[],
    chainId: number,
    readonly retries: number,
    readonly delay: number
  ) {
    // Initialize the super just with the chainId, which stops it from trying to immediately send out a .send before
    // this derived class is initialized.
    super(undefined, chainId);

    // Initialize the providers list with the provided parameters.
    this.providers = params.map((inputs) => new ethers.providers.StaticJsonRpcProvider(...inputs));
  }

  async send(method: string, params: Array<any>): Promise<any> {
    const primaryProvider = this.providers[0];
    const fallbackProviders = this.providers.slice(1);

    // This function is used to try to send with a provider and if it fails pop an element off the fallback list to try
    // with that one. Once the fallback provider list is empty, the method throws.
    const tryWithFallback = async (provider: ethers.providers.StaticJsonRpcProvider): Promise<any> => {
      try {
        return await this._trySend(provider, method, params);
      } catch (err) {
        // If there are no new fallback providers to use, terminate the recursion by throwing an error.
        // Otherwise, we can try to call another provider.
        const nextProvider = fallbackProviders.shift();
        if (nextProvider === undefined) throw err;
        return await tryWithFallback(nextProvider);
      }
    };

    return await tryWithFallback(primaryProvider);
  }

  _trySend(provider: ethers.providers.StaticJsonRpcProvider, method: string, params: Array<any>): Promise<any> {
    let promise = provider.send(method, params);
    for (let i = 0; i < this.retries; i++) {
      promise = promise.catch(() => delay(this.delay).then(() => provider.send(method, params)));
    }
    return promise;
  }
}

function getNodeUrlList(chainId: number): string[] {
  const retryConfigKey = `NODE_URLS_${chainId}`;
  const retryConfig = process.env[retryConfigKey];
  if (retryConfig) {
    const nodeUrls = JSON.parse(retryConfig) || [];
    if (nodeUrls?.length === 0)
      throw new Error(`Provided ${retryConfigKey}, but parsing it as json did not result in an array of urls.`);
    return nodeUrls;
  }

  const nodeUrlKey = `NODE_URL_${chainId}`;
  const nodeUrl = process.env[nodeUrlKey];

  if (nodeUrl) {
    return [nodeUrl];
  }

  throw new Error(
    `Cannot get node url(s) for ${chainId} because neither ${retryConfigKey} or ${nodeUrlKey} were provided.`
  );
}

export function getRetryProvider(chainId: number): EthersRetryProvider {
  const { NODE_RETRIES, NODE_RETRY_DELAY, NODE_TIMEOUT } = process.env;

  const timeout = Number(process.env[`NODE_TIMEOUT_${chainId}`] || NODE_TIMEOUT || defaultTimeout);

  // Default to 2 retries.
  const retries = Number(process.env[`NODE_RETRIES_${chainId}`] || NODE_RETRIES || "2");
  if (retries < 0 || !Number.isInteger(retries))
    throw new Error(`retries cannot be < 0 and must be an integer. Currently set to ${retries}`);

  // Default to a delay of 1 second between retries.
  const retryDelay = Number(process.env[`NODE_RETRY_DELAY_${chainId}`] || NODE_RETRY_DELAY || "1");
  if (retryDelay < 0) throw new Error(`delay cannot be < 0. Currently set to ${retryDelay}`);

  // Create a list of constructor arguments for each node url. Each element in the list is a tuple of the constructor
  // arguments for the StaticJsonRpcProvider. We do not check the length of the list here as getRetryProvider ensures
  // that at least one node url is provided.
  const constructorArgumentLists = getNodeUrlList(chainId).map((nodeUrl): [ethers.utils.ConnectionInfo, number] => [
    {
      url: nodeUrl,
      timeout,
      allowGzip: true,
    },
    chainId,
  ]);

  return new EthersRetryProvider(constructorArgumentLists, chainId, retries, retryDelay);
}
