import Web3 from "web3";
import assert from "assert";

export interface ProcessEnv {
  [key: string]: any;
}

export class TraderConfig {
  readonly financialContractAddress: string | undefined;
  readonly dsProxyFactoryAddress: string | undefined;

  readonly tokenPriceFeedConfig: object;
  readonly referencePriceFeedConfig: object;
  readonly exchangeAdapterConfig: object;

  constructor(env: ProcessEnv) {
    const {
      EMP_ADDRESS,
      TOKEN_PRICE_FEED_CONFIG,
      DS_PROXY_FACTORY_ADDRESS,
      REFERENCE_PRICE_FEED_CONFIG,
      EXCHANGE_ADAPTER_CONFIG
    } = env;
    assert(EMP_ADDRESS, "EMP_ADDRESS required");
    this.financialContractAddress = Web3.utils.toChecksumAddress(EMP_ADDRESS);
    this.dsProxyFactoryAddress = Web3.utils.toChecksumAddress(DS_PROXY_FACTORY_ADDRESS);

    this.tokenPriceFeedConfig = TOKEN_PRICE_FEED_CONFIG ? JSON.parse(TOKEN_PRICE_FEED_CONFIG) : null;
    this.referencePriceFeedConfig = REFERENCE_PRICE_FEED_CONFIG ? JSON.parse(REFERENCE_PRICE_FEED_CONFIG) : null;
    this.referencePriceFeedConfig = REFERENCE_PRICE_FEED_CONFIG ? JSON.parse(REFERENCE_PRICE_FEED_CONFIG) : null;
    this.exchangeAdapterConfig = EXCHANGE_ADAPTER_CONFIG ? JSON.parse(EXCHANGE_ADAPTER_CONFIG) : null;
  }
}
