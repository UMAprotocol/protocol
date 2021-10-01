import Web3 from "web3";
const { isAddress, toChecksumAddress, toBN } = Web3.utils;

import assert from "assert";

import type { RateModel } from "@uma/financial-templates-lib";

// Check each token rate model contains the expected data.
const expectedRateModelKeys = ["UBar", "R0", "R1", "R2"];

// const supported L2 Chain IDS:
const supportedChainIds = [
  10, // optimism mainnet
  69, // optimism testnet
  42161, // arbitrum mainnet
  421611, // arbitrum testnet
];

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
  readonly activatedChainIds: number[];

  constructor(env: ProcessEnv) {
    const { BRIDGE_ADMIN_ADDRESS, POLLING_DELAY, ERROR_RETRIES, ERROR_RETRIES_TIMEOUT, RATE_MODELS, CHAIN_IDS } = env;
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
      this.whitelistedRelayL1Tokens.push(toChecksumAddress(l1Token)); // ensure case is converted correctly

      assert(
        expectedRateModelKeys.every((item) =>
          Object.prototype.hasOwnProperty.call(processingRateModels[l1Token], item)
        ),
        `${toChecksumAddress(l1Token)} does not contain the required rate model keys ${expectedRateModelKeys}`
      );
      this.rateModels[toChecksumAddress(l1Token)] = {
        UBar: toBN(processingRateModels[l1Token].UBar),
        R0: toBN(processingRateModels[l1Token].R0),
        R1: toBN(processingRateModels[l1Token].R1),
        R2: toBN(processingRateModels[l1Token].R2),
      };
    }

    this.activatedChainIds = JSON.parse(CHAIN_IDS || "[]");
    assert(this.activatedChainIds.length > 0, "Must define at least 1 chain ID to run the bot against");
    assert(!this.activatedChainIds.includes(1), "Do not include chainID 1 in CHAIN_IDS");
    for (const id of this.activatedChainIds)
      assert(supportedChainIds.includes(id), `The chainID you provided: ${id} is not supported by this relayer`);
  }
}
