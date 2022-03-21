import Web3 from "web3";
const { toChecksumAddress } = Web3.utils;

// These are the block heights at which deposit box contracts were deployed on-chain. We use this in the fallback
// search for a FundsDeposited L2 event to optimize how we search for the event. We don't need to search for events
// earlier than the BridgeDepositBox's deployment block. We could try to automatically fetch this from on-chain
// state via an event that is emitted in the contract's constructor such as in the SetMinimumBridgingDelay event,
// but some L2 node providers don't allow long lookbacks (e.g. Infura Arbitrum) so hardcoding this mapping is an
// optimization that saves having to make extra web3 requests per bot run.
export const bridgeDepositBoxDeployData = {
  42161: { blockNumber: 2811998 },
  10: { blockNumber: 204576 },
  288: { blockNumber: 223808 },
};

export interface ProcessEnv {
  [key: string]: string | undefined;
}

// Set modes to true that you want to enable in bot (i.e. in Relayer.ts).
export interface BotModes {
  relayerEnabled: boolean; // Submits slow and fast relays
  disputerEnabled: boolean; // Submits disputes on pending relays with invalid params
  settlerEnabled: boolean; // Resolves expired relays
  l2FinalizerEnabled: boolean; // Facilitates L2->L1 bridging over the canonical roll-up bridge.
  l1FinalizerEnabled: boolean; // Finalizes the bridging action on L1 for tokens sent over the canonical roll-up bridge.
}
export class RelayerConfig {
  readonly bridgeAdmin: string;
  readonly rateModelStore: string;

  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;

  readonly whitelistedChainIds: number[] = [];
  readonly activatedChainIds: number[];
  readonly l2BlockLookback: number;

  readonly crossDomainFinalizationThreshold: number;
  readonly relayerDiscount: number;
  readonly botModes: BotModes;

  readonly l2DeployData: { [key: string]: { blockNumber: number } };

  constructor(env: ProcessEnv) {
    const {
      BRIDGE_ADMIN_ADDRESS,
      POLLING_DELAY,
      ERROR_RETRIES,
      ERROR_RETRIES_TIMEOUT,
      RATE_MODEL_ADDRESS,
      CHAIN_IDS,
      L2_BLOCK_LOOKBACK,
      CROSS_DOMAIN_FINALIZATION_THRESHOLD,
      RELAYER_DISCOUNT,
      RELAYER_ENABLED,
      SETTLER_ENABLED,
      DISPUTER_ENABLED,
      L1_FINALIZER_ENABLED,
      L2_FINALIZER_ENABLED,
      WHITELISTED_CHAIN_IDS,
      L2_DEPLOY_DATA,
    } = env;

    if (!BRIDGE_ADMIN_ADDRESS) throw new Error("BRIDGE_ADMIN_ADDRESS required");
    this.bridgeAdmin = toChecksumAddress(BRIDGE_ADMIN_ADDRESS);

    if (!RATE_MODEL_ADDRESS) throw new Error("RATE_MODEL_ADDRESS required");
    this.rateModelStore = toChecksumAddress(RATE_MODEL_ADDRESS);

    this.botModes = {
      relayerEnabled: RELAYER_ENABLED === "true" ? true : false,
      disputerEnabled: DISPUTER_ENABLED === "true" ? true : false,
      settlerEnabled: SETTLER_ENABLED === "true" ? true : false,
      l1FinalizerEnabled: L1_FINALIZER_ENABLED === "true" ? true : false,
      l2FinalizerEnabled: L2_FINALIZER_ENABLED === "true" ? true : false,
    };

    this.crossDomainFinalizationThreshold = CROSS_DOMAIN_FINALIZATION_THRESHOLD
      ? Number(CROSS_DOMAIN_FINALIZATION_THRESHOLD)
      : 5;

    if (this.crossDomainFinalizationThreshold >= 100)
      throw new Error("CROSS_DOMAIN_FINALIZATION_THRESHOLD must be < 100");

    this.relayerDiscount = RELAYER_DISCOUNT ? Number(RELAYER_DISCOUNT) : 0;
    if (this.relayerDiscount < 0 || this.relayerDiscount > 100)
      throw new Error("RELAYER_DISCOUNT must be between 0 and 100");

    // L2 start block must be explicitly set unlike L1 due to how L2 nodes work. For best practices, we also should
    // constrain L1 start blocks but this hasn't been an issue empirically. As a data point, Arbitrum Infura has a
    // query limit of up to 100,000 blocks into the past.

    // Note: Set this to some buffer below the 100,000 limit based on how the `index.ts` file computes the start block
    // to set in the L2 client. It takes the L2 latest block and then subtracts `L2_BLOCK_LOOKBACK` to get the start
    // block. A little after, the L2 client updates and sets its own `toBlock` to the latest L2 block at the update
    // time. Therefore, its possible that block height increases enough between the initial L2 latest block query and
    // the second one that more than 100,000 blocks are queried and the API throws an error.

    this.l2BlockLookback = L2_BLOCK_LOOKBACK ? Number(L2_BLOCK_LOOKBACK) : 99900;

    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;

    this.l2DeployData = L2_DEPLOY_DATA ? JSON.parse(L2_DEPLOY_DATA) : bridgeDepositBoxDeployData;

    // CHAIN_IDS sets the active chain ID's for this bot. Note how this is distinct from WHITELISTED_CHAIN_IDS which
    // sets all valid chain ID's. Any relays for chain ID's outside of this whitelist will be disputed.
    this.activatedChainIds = JSON.parse(CHAIN_IDS || "[]");
    if (this.activatedChainIds.length === 0) throw new Error("Must define at least 1 chain ID to run the bot against");
    if (this.activatedChainIds.includes(1)) throw new Error("Do not include chainID 1 in CHAIN_IDS");

    // Default whitelisted deposit chain ID's are Optimism and Arbitrum mainnet and testnet. Be VERY CAREFUL defining
    // this whitelist since any relays with non whitelisted chain IDs will be disputed!!
    if (!WHITELISTED_CHAIN_IDS) throw new Error("Must set WHITELISTED_CHAIN_IDS");
    this.whitelistedChainIds = JSON.parse(WHITELISTED_CHAIN_IDS);
    if (this.whitelistedChainIds.length === 0) throw new Error("Must define at least 1 whitelisted chain ID");
  }
}
