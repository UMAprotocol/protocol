export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  // User will pass in a node url to connect to Polygon network with.
  readonly chainId: string;
  // Any events older than now minus this value (in seconds) will be ignored.
  readonly lookback: number;

  constructor(env: ProcessEnv) {
    const { POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, LOOKBACK, CHAIN_ID } = env;

    this.chainId = CHAIN_ID || "";
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.lookback = LOOKBACK ? Number(LOOKBACK) : 8400; // Polygon Infura node cannot look back more than
    // 3500 blocks and 7200 seconds divided by an average block time of 2.4 seconds = 3000 blocks, safely under
    // the limit.
  }
}
