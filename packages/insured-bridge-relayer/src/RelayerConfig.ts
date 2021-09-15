import Web3 from "web3";
import assert from "assert";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly bridgeAdmin: string;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  readonly whitelistedRelayL1Tokens: string[];

  constructor(env: ProcessEnv) {
    const { BRIDGE_ADMIN_ADDRESS, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, WHITELISTED_L1_TOKENS } = env;
    assert(BRIDGE_ADMIN_ADDRESS, "BRIDGE_ADMIN_ADDRESS required");
    this.bridgeAdmin = Web3.utils.toChecksumAddress(BRIDGE_ADMIN_ADDRESS);

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    assert(WHITELISTED_L1_TOKENS, "WHITELISTED_L1_TOKENS required");
    this.whitelistedRelayL1Tokens = JSON.parse(WHITELISTED_L1_TOKENS);
    assert(this.whitelistedRelayL1Tokens.length > 0, "At least one token must be whitelisted");
  }
}
