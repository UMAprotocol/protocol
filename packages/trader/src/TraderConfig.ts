import Web3 from "web3";
import assert from "assert";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class TraderConfig {
  readonly financialContractAddress: string;
  readonly dsProxyFactoryAddress: string | null;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  readonly tokenPriceFeedConfig: any;
  readonly referencePriceFeedConfig: any;
  readonly exchangeAdapterConfig: any;

  constructor(env: ProcessEnv) {
    const {
      EMP_ADDRESS,
      TOKEN_PRICE_FEED_CONFIG,
      POLLING_DELAY,
      ERROR_RETRIES,
      ERROR_RETRIES_TIMEOUT,
      DS_PROXY_FACTORY_ADDRESS,
      REFERENCE_PRICE_FEED_CONFIG,
      EXCHANGE_ADAPTER_CONFIG
    } = env;
    assert(EMP_ADDRESS, "EMP_ADDRESS required");
    this.financialContractAddress = Web3.utils.toChecksumAddress(EMP_ADDRESS);
    this.dsProxyFactoryAddress = DS_PROXY_FACTORY_ADDRESS
      ? Web3.utils.toChecksumAddress(DS_PROXY_FACTORY_ADDRESS)
      : null;
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.tokenPriceFeedConfig = TOKEN_PRICE_FEED_CONFIG ? JSON.parse(TOKEN_PRICE_FEED_CONFIG) : null;
    this.referencePriceFeedConfig = REFERENCE_PRICE_FEED_CONFIG ? JSON.parse(REFERENCE_PRICE_FEED_CONFIG) : null;
    this.exchangeAdapterConfig = EXCHANGE_ADAPTER_CONFIG ? JSON.parse(EXCHANGE_ADAPTER_CONFIG) : null;
  }
}
