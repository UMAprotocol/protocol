import Web3 from "web3";
const { isAddress } = Web3.utils;

import assert from "assert";

import type { RateModel } from "@uma/financial-templates-lib";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly bridgeAdmin: string;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  readonly whitelistedRelayL1Tokens: string[] = [];
  readonly rateModels: { [key: string]: RateModel } = {};

  constructor(env: ProcessEnv) {
    const { BRIDGE_ADMIN_ADDRESS, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, RATE_MODELS } = env;
    assert(BRIDGE_ADMIN_ADDRESS, "BRIDGE_ADMIN_ADDRESS required");
    this.bridgeAdmin = Web3.utils.toChecksumAddress(BRIDGE_ADMIN_ADDRESS);

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;

    assert(RATE_MODELS, "RATE_MODELS required");
    const processingRateModels = JSON.parse(RATE_MODELS);

    for (const l1Token of Object.keys(processingRateModels)) {
      // Check the keys in the rate model provided are addresses.
      assert(isAddress(l1Token), "Bad l1Token provided in rate model!");

      // Append this key to the whitelistedRelayL1Tokens array.
      this.whitelistedRelayL1Tokens.push(l1Token);

      // Check each token rate model contains the expected data.
      const expectedRateModelKeys = ["UBar", "R0", "R1", "R2"];

      assert(
        expectedRateModelKeys.every((item) =>
          Object.prototype.hasOwnProperty.call(processingRateModels[l1Token], item)
        ),
        `${l1Token} does not contain the required rate model keys ${expectedRateModelKeys}`
      );
      this.rateModels[l1Token] = {
        UBar: processingRateModels[l1Token].UBar,
        R0: processingRateModels[l1Token].R0,
        R1: processingRateModels[l1Token].R1,
        R2: processingRateModels[l1Token].R2,
      };
    }
  }
}
