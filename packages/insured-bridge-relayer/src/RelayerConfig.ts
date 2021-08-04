import Web3 from "web3";
import assert from "assert";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly bridgePoolFactoryAddress: string;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  constructor(env: ProcessEnv) {
    const { BRIDGE_POOL_FACTORY_ADDRESS, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT } = env;
    assert(BRIDGE_POOL_FACTORY_ADDRESS, "BRIDGE_POOL_FACTORY_ADDRESS required");
    this.bridgePoolFactoryAddress = Web3.utils.toChecksumAddress(BRIDGE_POOL_FACTORY_ADDRESS);

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
  }
}
