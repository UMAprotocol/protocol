import assert from "assert";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  // We reuse the infura key to connect to Polygon and Ethereum networks.
  readonly infuraApiKey: string;
  // Any events older than now minus this value (in seconds) will be ignored.
  readonly lookback: number;

  constructor(env: ProcessEnv) {
    const { INFURA_API_KEY, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, LOOKBACK } = env;
    assert(INFURA_API_KEY, "INFURA_API_KEY required");
    this.infuraApiKey = INFURA_API_KEY;
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.lookback = LOOKBACK ? Number(LOOKBACK) : 259200; // 3 days.
  }
}
