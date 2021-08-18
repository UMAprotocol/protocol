export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  // User will pass in a node url to connect to Polygon network with.
  readonly polygonNodeUrl: string;
  // Any events older than now minus this value (in seconds) will be ignored.
  readonly lookback: number;

  constructor(env: ProcessEnv) {
    const { POLYGON_CUSTOM_NODE_URL, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, LOOKBACK } = env;

    this.polygonNodeUrl = POLYGON_CUSTOM_NODE_URL ? POLYGON_CUSTOM_NODE_URL : "";
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.lookback = LOOKBACK ? Number(LOOKBACK) : 259200; // 3 days.
  }
}
