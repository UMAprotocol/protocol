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
  readonly maxCalldataBytes: number;

  constructor(env: ProcessEnv) {
    const { POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, LOOKBACK, CHAIN_ID, MAX_CALLDATA_BYTES } = env;

    this.maxCalldataBytes = MAX_CALLDATA_BYTES === undefined ? 120_000 : Number(MAX_CALLDATA_BYTES);
    if (!Number.isSafeInteger(this.maxCalldataBytes) || this.maxCalldataBytes <= 0) {
      throw new Error("MAX_CALLDATA_BYTES must be a positive safe integer");
    }
    this.chainId = CHAIN_ID || "";
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.lookback = LOOKBACK ? Number(LOOKBACK) : 172800; // ~2 days
  }
}
