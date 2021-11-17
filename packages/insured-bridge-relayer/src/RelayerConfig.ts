import Web3 from "web3";
const { isAddress, toChecksumAddress, toBN } = Web3.utils;

import assert from "assert";
import { replaceAddressCase } from "@uma/common";

import type { RateModel } from "@uma/financial-templates-lib";

// Check each token rate model contains the expected data.
const expectedRateModelKeys = ["UBar", "R0", "R1", "R2"];

// Supported L2 Chain IDS:
const supportedChainIds = [
  10, // optimism mainnet
  69, // optimism testnet
  42161, // arbitrum mainnet
  421611, // arbitrum testnet
];

// This struct is a hack right now but prevents an edge case bug where a deposit.quoteTime < bridgePool.deployment time.
// The deposit.quoteTime is used to call bridgePool.liquidityUtilizationCurrent at a specific block height. This call
// always reverts if the quote time is before the bridge pool's deployment time. This causes the disputer to error out
// because it cannot validate a relay's realizedLpFeePct properly. We need to therefore know which deposit quote times
// are off-limits and need to either be ignored or auto-disputed. This is a hack because ideally the bridgePool sets
// a timestamp on construction. Then we can easily query on-chain whether a deposit.quoteTime is before this timestamp.
// The alternative to using this hard-coded mapping is to call `web3.eth.getCode(bridgePoolAddress, blockNumber)` but
// making a web3 call per relay is expensive. Therefore this mapping is also a runtime optimization where we can
// eliminate web3 calls.
const bridgePoolDeployData = {
  // Note: keyed by L1 token.
  // WETH:
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
    timestamp: 1635962805,
  },
  // USDC:
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
    timestamp: 1635964115,
  },
  // UMA:
  "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828": {
    timestamp: 1635964053,
  },
  // BADGER:
  "0x3472a5a71965499acd81997a54bba8d852c6e53d": {
    timestamp: 1636750354,
  },
};

// For similar reasons to why we store BridgePool deployment times, we store BridgeDepositBox times for each L2 network
// here. We use this in the fallback search for a FundsDeposited L2 event to optimize how we search for the event. We
// don't need to search for events earlier than the BridgeDepositBox's deployment block.
const bridgeDepositBoxDeployData = {
  42161: {
    blockNumber: 2811998,
  },
};

export interface ProcessEnv {
  [key: string]: string | undefined;
}

// Set modes to true that you want to enable in bot (i.e. in Relayer.ts).
export interface BotModes {
  relayerEnabled: boolean; // Submits slow and fast relays
  disputerEnabled: boolean; // Submits disputes on pending relays with invalid params
  finalizerEnabled: boolean; // Resolves expired relays
  l2FinalizerEnabled: boolean; // Facilitates L2->L1 bridging over the canonical roll-up bridge.
}
export class RelayerConfig {
  readonly bridgeAdmin: string;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  readonly whitelistedRelayL1Tokens: string[] = [];
  readonly whitelistedChainIds: number[] = [];
  readonly rateModels: { [key: string]: RateModel } = {};
  readonly activatedChainIds: number[];
  readonly l2BlockLookback: number;
  readonly crossDomainFinalizationThreshold: number;
  readonly botModes: BotModes;
  readonly l1DeployData: { [key: string]: { timestamp: number } };
  readonly l2DeployData: { [key: string]: { blockNumber: number } };

  constructor(env: ProcessEnv) {
    const {
      BRIDGE_ADMIN_ADDRESS,
      POLLING_DELAY,
      ERROR_RETRIES,
      ERROR_RETRIES_TIMEOUT,
      RATE_MODELS,
      CHAIN_IDS,
      L2_BLOCK_LOOKBACK,
      CROSS_DOMAIN_FINALIZATION_THRESHOLD,
      RELAYER_ENABLED,
      FINALIZER_ENABLED,
      DISPUTER_ENABLED,
      CROSS_DOMAIN_FINALIZER_ENABLED,
      WHITELISTED_CHAIN_IDS,
      L1_DEPLOY_DATA,
      L2_DEPLOY_DATA,
    } = env;

    assert(BRIDGE_ADMIN_ADDRESS, "BRIDGE_ADMIN_ADDRESS required");
    this.bridgeAdmin = toChecksumAddress(BRIDGE_ADMIN_ADDRESS);

    this.botModes = {
      relayerEnabled: RELAYER_ENABLED === "true" ? true : false,
      disputerEnabled: DISPUTER_ENABLED === "true" ? true : false,
      finalizerEnabled: FINALIZER_ENABLED === "true" ? true : false,
      l2FinalizerEnabled: CROSS_DOMAIN_FINALIZER_ENABLED === "true" ? true : false,
    };

    this.crossDomainFinalizationThreshold = CROSS_DOMAIN_FINALIZATION_THRESHOLD
      ? Number(CROSS_DOMAIN_FINALIZATION_THRESHOLD)
      : 5;

    assert(this.crossDomainFinalizationThreshold < 100, "CROSS_DOMAIN_FINALIZATION_THRESHOLD must be < 100");

    // L2 start block must be explicitly set unlike L1 due to how L2 nodes work. For best practices, we also should
    // constrain L1 start blocks but this hasn't been an issue empirically. As a data point, Arbitrum Infura has a
    // query limit of up to 100,000 blocks into the past.
    this.l2BlockLookback = L2_BLOCK_LOOKBACK ? Number(L2_BLOCK_LOOKBACK) : 99999;

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;

    this.l1DeployData = replaceAddressCase(L1_DEPLOY_DATA ? JSON.parse(L1_DEPLOY_DATA) : bridgePoolDeployData);
    this.l2DeployData = L2_DEPLOY_DATA ? JSON.parse(L2_DEPLOY_DATA) : bridgeDepositBoxDeployData;

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

    // CHAIN_IDS sets the active chain ID's for this bot. Note how this is distinct from WHITELISTED_CHAIN_IDS which
    // sets all valid chain ID's. Any relays for chain ID's outside of this whitelist will be disputed.
    this.activatedChainIds = JSON.parse(CHAIN_IDS || "[]");
    assert(this.activatedChainIds.length > 0, "Must define at least 1 chain ID to run the bot against");
    assert(!this.activatedChainIds.includes(1), "Do not include chainID 1 in CHAIN_IDS");
    for (const id of this.activatedChainIds)
      assert(supportedChainIds.includes(id), `The chainID you provided: ${id} is not supported by this relayer`);

    // Default whitelisted deposit chain ID's are Optimism and Arbitrum mainnet and testnet. Be VERY CAREFUL defining
    // this whitelist since any relays with non whitelisted chain IDs will be disputed!!
    this.whitelistedChainIds = WHITELISTED_CHAIN_IDS ? JSON.parse(WHITELISTED_CHAIN_IDS) : supportedChainIds;
    assert(this.whitelistedChainIds.length > 0, "Must define at least 1 whitelisted chain ID");
    for (const id of this.whitelistedChainIds)
      assert(
        supportedChainIds.includes(id),
        `The whitelisted chainID you provided: ${id} is not supported by this relayer`
      );
  }
}
