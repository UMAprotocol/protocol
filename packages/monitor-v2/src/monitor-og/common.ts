import {
  ContractAddresses as zodiacContractAddresses,
  SupportedNetworks as zodiacSupportedNetworks,
} from "@gnosis.pm/zodiac";
import {
  createTenderlyFork,
  getGckmsSigner,
  getRetryProvider,
  shareTenderlyFork,
  simulateTenderlyTx,
  TenderlySimulationParams,
  TenderlySimulationResult,
} from "@uma/common";
import { ERC20Ethers, FinderEthers, getAddress, ModuleProxyFactoryEthers, StoreEthers } from "@uma/contracts-node";
import { ModuleProxyCreationEvent } from "@uma/contracts-node/typechain/core/ethers/ModuleProxyFactory";
import { TransactionsProposedEvent } from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import { delay } from "@uma/financial-templates-lib";
import { Options as RetryOptions } from "async-retry";
import { BigNumber, Contract, Event, EventFilter, providers, Signer, utils, Wallet } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "./common";
import { SnapshotProposalExpanded } from "./oSnapAutomation";

import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";
export { generateOOv3UILink } from "../utils/logger";

export interface BotModes {
  transactionsProposedEnabled: boolean;
  transactionsExecutedEnabled: boolean;
  proposalExecutedEnabled: boolean;
  proposalDeletedEnabled: boolean;
  setCollateralAndBondEnabled: boolean;
  setRulesEnabled: boolean;
  setLivenessEnabled: boolean;
  setIdentifierEnabled: boolean;
  setEscalationManagerEnabled: boolean;
  proxyDeployedEnabled: boolean;
  automaticProposalsEnabled: boolean;
  automaticDisputesEnabled: boolean;
  automaticExecutionsEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface SupportedBonds {
  [key: string]: string; // We enforce that the keys are valid addresses and the values are valid amounts in type guard.
}

export interface MonitoringParams {
  ogAddresses: string[];
  ogBlacklist?: string[]; // Optional. Only used in automatic OG address discovery mode.
  moduleProxyFactoryAddresses: string[];
  ogMasterCopyAddresses: string[];
  provider: Provider;
  signer?: Signer; // Optional. Only used in automatic support mode.
  chainId: number;
  blockRange: BlockRange;
  pollingDelay: number;
  snapshotEndpoint: string;
  graphqlEndpoint: string;
  ipfsEndpoint: string;
  approvalChoices: string[];
  supportedBonds?: SupportedBonds; // Optional. Only used in automated support mode.
  submitAutomation: boolean; // Defaults to true, but only used in automated support mode.
  automaticExecutionGasLimit: BigNumber; // Defaults to 500k, but only used in automated support mode.
  disputeIpfsServerErrors: boolean; // Defaults to false, but only used in automated support mode.
  assertionBlacklist: string[]; // Defaults to empty array. Only used in automated support mode.
  useTenderly: boolean;
  botModes: BotModes;
  retryOptions: RetryOptions;
  reproposeDisputed: boolean; // Defaults to false, so we don't repropose disputed proposals.
  storage: "datastore" | "file"; // Defaults to "datastore", but only used when notifying new proposals.
}

export interface ForkedTenderlyResult {
  forkUrl: string;
  lastSimulation: TenderlySimulationResult;
}

// Helper type guard for dictionary objects.
export const isDictionary = (arg: unknown): arg is Record<string, unknown> => {
  return typeof arg === "object" && arg !== null && !Array.isArray(arg);
};

// Type guard for SupportedBonds.
const isSupportedBonds = (bonds: unknown): bonds is SupportedBonds => {
  if (!isDictionary(bonds)) return false;

  // addressKeys is used to check for duplicate addresses.
  const addressKeys = new Set<string>();
  for (const key in bonds) {
    if (!utils.isAddress(key)) return false;

    // Check for duplicate addresses.
    const addressKey = utils.getAddress(key);
    if (addressKeys.has(addressKey)) return false;
    addressKeys.add(addressKey);

    // Check for valid amounts.
    if (typeof bonds[key] !== "string") return false;
    try {
      BigNumber.from(bonds[key]); // BigNumber.from throws if value is not a valid number.
    } catch {
      return false;
    }
    if (!BigNumber.from(bonds[key]).gte(0)) return false; // Bond amount cannot be negative.
  }
  return true;
};

const parseSupportedBonds = (env: NodeJS.ProcessEnv): SupportedBonds => {
  if (!env.SUPPORTED_BONDS) throw new Error("SUPPORTED_BONDS must be defined in env");
  const supportedBonds = JSON.parse(env.SUPPORTED_BONDS);
  if (!isSupportedBonds(supportedBonds)) throw new Error("SUPPORTED_BONDS must contain valid addresses and amounts");
  return supportedBonds;
};

const getSigner = async (env: NodeJS.ProcessEnv, provider: Provider): Promise<Signer> => {
  if (env.GCKMS_WALLET) {
    return (await getGckmsSigner()).connect(provider);
  } else if (env.MNEMONIC) {
    return Wallet.fromMnemonic(env.MNEMONIC).connect(provider);
  } else throw new Error("Must define either GCKMS_WALLET or MNEMONIC in env");
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv, _provider?: Provider): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // OG_ADDRESS, OG_WHITELIST and OG_BLACKLIST are mutually exclusive.
  // If none are provided, the bots will monitor all deployed proxies.
  if ([env.OG_ADDRESS, env.OG_WHITELIST, env.OG_BLACKLIST].filter(Boolean).length > 1) {
    throw new Error("OG_ADDRESS, OG_WHITELIST and OG_BLACKLIST are mutually exclusive");
  }

  // If no module proxy factory addresses are provided, default to the latest version of Zodiac factory address if
  // chainId is supported. This can be empty as not all bot configs require monitoring proxy deployments.
  const fallbackModuleProxyFactoryAddresses = Object.values(zodiacSupportedNetworks).includes(chainId)
    ? [zodiacContractAddresses[chainId as zodiacSupportedNetworks].factory]
    : [];
  const moduleProxyFactoryAddresses: string[] = env.MODULE_PROXY_FACTORY_ADDRESSES
    ? JSON.parse(env.MODULE_PROXY_FACTORY_ADDRESSES)
    : fallbackModuleProxyFactoryAddresses;

  // If no OG mastercopy addresses are provided, default to the protocol deployment address if chainId is supported.
  // This can be empty as not all bot configs require monitoring proxy deployments.
  const fallbackOgMasterCopyAddresses = [];
  try {
    const ogMasterCopyAddress = await getAddress("OptimisticGovernor", chainId);
    fallbackOgMasterCopyAddresses.push(ogMasterCopyAddress);
  } catch (err) {
    // Fallback to empty array if no deployment was found.
  }
  const ogMasterCopyAddresses: string[] = env.OG_MASTER_COPY_ADDRESSES
    ? JSON.parse(env.OG_MASTER_COPY_ADDRESSES)
    : fallbackOgMasterCopyAddresses;

  const STARTING_BLOCK_KEY = `STARTING_BLOCK_NUMBER_${chainId}`;
  const ENDING_BLOCK_KEY = `ENDING_BLOCK_NUMBER_${chainId}`;

  // Creating provider will check for other chainId specific env variables.
  // When testing, we can pass in a provider directly.
  const provider = _provider === undefined ? ((await getRetryProvider(chainId)) as Provider) : _provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env[STARTING_BLOCK_KEY] || !env[ENDING_BLOCK_KEY])) {
    throw new Error(`Must provide ${STARTING_BLOCK_KEY} and ${ENDING_BLOCK_KEY} if running serverless`);
  }

  // If no block numbers are provided, default to the latest block.
  const latestBlockNumber: number = await provider.getBlockNumber();
  const startingBlock = env[STARTING_BLOCK_KEY] ? Number(env[STARTING_BLOCK_KEY]) : latestBlockNumber;
  const endingBlock = env[ENDING_BLOCK_KEY] ? Number(env[ENDING_BLOCK_KEY]) : latestBlockNumber;
  // In serverless it is possible for start block to be larger than end block if no new blocks were mined since last run.
  if (startingBlock > endingBlock && pollingDelay !== 0) {
    throw new Error(`${STARTING_BLOCK_KEY} must be less than or equal to ${ENDING_BLOCK_KEY}`);
  }

  // Parameters for Snapshot proposal verification.
  const snapshotEndpoint = env.SNAPSHOT_ENDPOINT || "https://snapshot.org";
  const graphqlEndpoint = env.GRAPHQL_ENDPOINT || "https://hub.snapshot.org/graphql";
  const ipfsEndpoint = env.IPFS_ENDPOINT || "https://cloudflare-ipfs.com/ipfs";
  const approvalChoices = env.APPROVAL_CHOICES ? JSON.parse(env.APPROVAL_CHOICES) : ["Yes", "For", "YAE"];

  // Use Tenderly simulation link only if all required environment variables are set.
  const useTenderly =
    env.TENDERLY_USER !== undefined && env.TENDERLY_PROJECT !== undefined && env.TENDERLY_ACCESS_KEY !== undefined;

  const botModes = {
    transactionsProposedEnabled: env.TRANSACTIONS_PROPOSED_ENABLED === "true",
    transactionsExecutedEnabled: env.TRANSACTIONS_EXECUTED_ENABLED === "true",
    proposalExecutedEnabled: env.PROPOSAL_EXECUTED_ENABLED === "true",
    proposalDeletedEnabled: env.PROPOSAL_DELETED_ENABLED === "true",
    setCollateralAndBondEnabled: env.SET_COLLATERAL_BOND_ENABLED === "true",
    setRulesEnabled: env.SET_RULES_ENABLED === "true",
    setLivenessEnabled: env.SET_LIVENESS_ENABLED === "true",
    setIdentifierEnabled: env.SET_IDENTIFIER_ENABLED === "true",
    setEscalationManagerEnabled: env.SET_ESCALATION_MANAGER_ENABLED === "true",
    proxyDeployedEnabled: env.PROXY_DEPLOYED_ENABLED === "true",
    automaticProposalsEnabled: env.AUTOMATIC_PROPOSALS_ENABLED === "true",
    automaticDisputesEnabled: env.AUTOMATIC_DISPUTES_ENABLED === "true",
    automaticExecutionsEnabled: env.AUTOMATIC_EXECUTIONS_ENABLED === "true",
    notifyNewProposalsEnabled: env.NOTIFY_NEW_PROPOSALS_ENABLED === "true",
  };

  // Parse supported bonds and get signer if any of automatic support modes are enabled.
  let supportedBonds: SupportedBonds | undefined;
  let signer: Signer | undefined;
  if (botModes.automaticProposalsEnabled || botModes.automaticDisputesEnabled || botModes.automaticExecutionsEnabled) {
    supportedBonds = parseSupportedBonds(env);
    signer = await getSigner(env, provider);
  }

  // By default, submit automation mode transactions (propose/dispute/execute) unless explicitly disabled. This does not
  // apply to bond approvals as these are always submitted on chain.
  const submitAutomation = env.SUBMIT_AUTOMATION === "false" ? false : true;

  // By default, set automatic execution gas limit to 500k unless explicitly set.
  const automaticExecutionGasLimit = env.AUTOMATIC_EXECUTION_GAS_LIMIT
    ? BigNumber.from(env.AUTOMATIC_EXECUTION_GAS_LIMIT)
    : BigNumber.from(500000);

  // By default, do not dispute on IPFS server errors unless explicitly enabled.
  const disputeIpfsServerErrors = env.DISPUTE_IPFS_SERVER_ERRORS === "true" ? true : false;

  // By default, do not blacklist assertions unless explicitly enabled.
  const assertionBlacklist: string[] = env.ASSERTION_BLACKLIST ? JSON.parse(env.ASSERTION_BLACKLIST) : [];

  // Mastercopy and module proxy factory addresses are required when monitoring proxy deployments or when not
  // explicitly providing OG_ADDRESS to monitor in other modes.
  if (
    (botModes.proxyDeployedEnabled || !env.OG_ADDRESS) &&
    (ogMasterCopyAddresses.length === 0 || moduleProxyFactoryAddresses.length === 0)
  ) {
    throw new Error(
      "No mastercopy or module proxy factory addresses found: required when monitoring proxy deployments" +
        " or OG_ADDRESS is not set"
    );
  }

  // Retry options used when fetching off-chain information from Snapshot.
  const retryOptions: RetryOptions = {
    retries: env.SNAPSHOT_RETRIES ? Number(env.SNAPSHOT_RETRIES) : 3, // Maximum number of retries.
    minTimeout: env.SNAPSHOT_TIMEOUT ? Number(env.SNAPSHOT_TIMEOUT) : 1000, // Milliseconds before starting the first retry.
  };

  // Storage type to keep state on notified Snapshot proposals.
  const storage = env.STORAGE || "datastore";
  if (storage !== "datastore" && storage !== "file") {
    throw new Error(`Invalid STORAGE type: ${storage}`);
  }

  // By default, do not re-propose disputed proposals.
  const reproposeDisputed = env.REPROPOSE_DISPUTED === "true" ? true : false;

  const initialParams: MonitoringParams = {
    ogAddresses: [], // Will be added later after validation.
    moduleProxyFactoryAddresses,
    ogMasterCopyAddresses,
    provider,
    signer,
    chainId,
    blockRange: { start: startingBlock, end: endingBlock },
    pollingDelay,
    snapshotEndpoint,
    graphqlEndpoint,
    ipfsEndpoint,
    approvalChoices,
    supportedBonds,
    submitAutomation,
    automaticExecutionGasLimit,
    disputeIpfsServerErrors,
    assertionBlacklist,
    useTenderly,
    botModes,
    retryOptions,
    storage,
    reproposeDisputed,
  };

  // If OG_ADDRESS is provided, use it in the monitored address list and return monitoring params.
  // Invalid address will throw an error in getAddress call.
  if (env.OG_ADDRESS) {
    initialParams.ogAddresses = [utils.getAddress(env.OG_ADDRESS)];
    return initialParams;
  }

  // Verify that OG whitelist and blacklist contain only deployed proxy addresses.
  // Invalid addresses will throw an error in getAddress call.
  const deployedProxyAddresses = await getDeployedProxyAddresses(initialParams, {
    start: 0,
    end: initialParams.blockRange.end,
  });
  const deployedProxyAddressesSet = new Set(deployedProxyAddresses);
  const ogWhitelist: string[] = env.OG_WHITELIST ? JSON.parse(env.OG_WHITELIST) : [];
  const ogBlacklist: string[] = env.OG_BLACKLIST ? JSON.parse(env.OG_BLACKLIST) : [];
  ogWhitelist.forEach((address) => {
    if (!deployedProxyAddressesSet.has(utils.getAddress(address))) {
      throw new Error(`OG_WHITELIST contains address ${address} that is not a deployed proxy`);
    }
  });
  ogBlacklist.forEach((address) => {
    if (!deployedProxyAddressesSet.has(utils.getAddress(address))) {
      throw new Error(`OG_BLACKLIST contains address ${address} that is not a deployed proxy`);
    }
  });

  // If OG whitelist is provided, use it in the monitored address list and return monitoring params.
  if (env.OG_WHITELIST) {
    initialParams.ogAddresses = ogWhitelist.map((address) => utils.getAddress(address));
    return initialParams;
  }

  // We are in automatic OG address discovery mode. Return monitoring params with all deployed proxies except those
  // in the blacklist.
  initialParams.ogAddresses = deployedProxyAddresses.filter(
    (address) => !ogBlacklist.includes(utils.getAddress(address))
  );
  initialParams.ogBlacklist = ogBlacklist.map((address) => utils.getAddress(address));

  return initialParams;
};

export const waitNextBlockRange = async (params: MonitoringParams): Promise<BlockRange> => {
  await delay(Number(params.pollingDelay));
  const latestBlockNumber: number = await params.provider.getBlockNumber();
  return { start: params.blockRange.end + 1, end: latestBlockNumber };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};

export const tryHexToUtf8String = (ancillaryData: string): string => {
  try {
    return utils.toUtf8String(ancillaryData);
  } catch (err) {
    return ancillaryData;
  }
};

export const getCurrencyDecimals = async (provider: Provider, currencyAddress: string): Promise<number> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.decimals();
  } catch (err) {
    return 18;
  }
};

export const getCurrencySymbol = async (provider: Provider, currencyAddress: string): Promise<string> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.symbol();
  } catch (err) {
    // Try to get the symbol as bytes32 (e.g. MKR uses this).
    try {
      const bytes32SymbolIface = new utils.Interface(["function symbol() view returns (bytes32 symbol)"]);
      const bytes32Symbol = await provider.call({
        to: currencyAddress,
        data: bytes32SymbolIface.encodeFunctionData("symbol"),
      });
      return utils.parseBytes32String(bytes32SymbolIface.decodeFunctionResult("symbol", bytes32Symbol).symbol);
    } catch (err) {
      return "";
    }
  }
};

export const runQueryFilter = async <T extends Event>(
  contract: Contract,
  filter: EventFilter,
  blockRange: BlockRange
): Promise<Array<T>> => {
  return contract.queryFilter(filter, blockRange.start, blockRange.end) as Promise<Array<T>>;
};

export const getOgByAddress = async (params: MonitoringParams, address: string): Promise<OptimisticGovernorEthers> => {
  return await getContractInstanceWithProvider<OptimisticGovernorEthers>(
    "OptimisticGovernor",
    params.provider,
    address
  );
};

export const getOo = async (params: MonitoringParams): Promise<OptimisticOracleV3Ethers> => {
  return await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);
};

export const getProxyDeploymentTxs = async (params: MonitoringParams): Promise<Array<ModuleProxyCreationEvent>> => {
  const moduleProxyFactories = await Promise.all(
    params.moduleProxyFactoryAddresses.map(async (moduleProxyFactoryAddress) => {
      return await getContractInstanceWithProvider<ModuleProxyFactoryEthers>(
        "ModuleProxyFactory",
        params.provider,
        moduleProxyFactoryAddress
      );
    })
  );
  const transactions = (
    await Promise.all(
      moduleProxyFactories.map((moduleProxyFactory) =>
        Promise.all(
          params.ogMasterCopyAddresses.map((ogMasterCopy) =>
            runQueryFilter<ModuleProxyCreationEvent>(
              moduleProxyFactory,
              moduleProxyFactory.filters.ModuleProxyCreation(null, ogMasterCopy),
              params.blockRange
            )
          )
        )
      )
    )
  ).flat(2);
  return transactions;
};

const getDeployedProxyAddresses = async (
  params: MonitoringParams,
  blockRangeOverride: BlockRange
): Promise<Array<string>> => {
  const clonedParams = Object.assign({}, params);
  clonedParams.blockRange = blockRangeOverride;
  const transactions = await getProxyDeploymentTxs(clonedParams);
  return transactions.map((tx) => utils.getAddress(tx.args.proxy));
};

export const getOgAddresses = async (params: MonitoringParams): Promise<Array<string>> => {
  // Return the same list of addresses if not in automatic OG address discovery mode.
  if (params.ogBlacklist === undefined) return params.ogAddresses;

  const deployedProxyAddresses = await getDeployedProxyAddresses(params, params.blockRange);
  const ogAddresses = deployedProxyAddresses.filter(
    (address) => !params.ogBlacklist?.includes(utils.getAddress(address))
  );
  return [...params.ogAddresses, ...ogAddresses];
};

export const getBlockTimestamp = async (provider: Provider, blockNumber: number): Promise<number> => {
  const block = await provider.getBlock(blockNumber);
  return block.timestamp;
};

export const generateTenderlySimulation = async (
  proposedEvent: TransactionsProposedEvent,
  params: MonitoringParams
): Promise<TenderlySimulationResult> => {
  // Get the execution payload.
  const og = await getOgByAddress(params, proposedEvent.address);
  const executionPayload = og.interface.encodeFunctionData("executeProposal", [
    proposedEvent.args.proposal.transactions,
  ]);

  // Simulate proposal execution from zero address after challenge window ends.
  const simulationParams: TenderlySimulationParams = {
    chainId: params.chainId,
    to: proposedEvent.address,
    input: executionPayload,
    timestampOverride: proposedEvent.args.challengeWindowEnds.toNumber(),
  };
  return await simulateTenderlyTx(simulationParams, params.retryOptions);
};

// Generates forked Tenderly simulation for active proposals. This is used to verify the proposal before it is posted
// on-chain.
export const generateForkedSimulation = async (
  proposal: SnapshotProposalExpanded,
  retryOptions: RetryOptions
): Promise<ForkedTenderlyResult> => {
  // Create and share Tenderly fork.
  const chainId = Number(proposal.safe.network);
  const alias = `${proposal.space.id} proposal ${proposal.id} on ${proposal.safe.umaAddress}, chainId ${chainId}`;
  const fork = await createTenderlyFork({ chainId, alias });
  const forkProvider = new providers.StaticJsonRpcProvider(fork.rpcUrl);
  const forkUrl = await shareTenderlyFork(fork.id);

  // Set bond amount to 0 in order to simplify proposal simulation. First, set it on the OG module.
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>(
    "OptimisticGovernor",
    forkProvider,
    proposal.safe.umaAddress
  );
  const ogOwnerAddress = await og.owner();
  const collateralAddress = await og.collateral();
  const simulation1 = await simulateTenderlyTx(
    {
      chainId,
      from: ogOwnerAddress,
      to: proposal.safe.umaAddress,
      input: og.interface.encodeFunctionData("setCollateralAndBond", [collateralAddress, 0]),
      fork: { id: fork.id, root: fork.headId },
      description: "Set bond to 0 in oSnap module",
    },
    retryOptions
  );
  if (!simulation1.status) return { forkUrl, lastSimulation: simulation1 };

  // Also set bond amount to 0 in Store.
  const finderAddress = await og.finder();
  const finder = await getContractInstanceWithProvider<FinderEthers>("Finder", forkProvider, finderAddress);
  const storeAddress = await finder.getImplementationAddress(utils.formatBytes32String("Store"));
  const store = await getContractInstanceWithProvider<StoreEthers>("Store", forkProvider, storeAddress);
  const storeOwnerAddress = await store.getMember(0);
  const simulation2 = await simulateTenderlyTx(
    {
      chainId,
      from: storeOwnerAddress,
      to: storeAddress,
      input: store.interface.encodeFunctionData("setFinalFee", [collateralAddress, { rawValue: 0 }]),
      fork: { id: fork.id, root: simulation1.id },
      description: "Set bond to 0 in Store",
    },
    retryOptions
  );
  if (!simulation2.status) return { forkUrl, lastSimulation: simulation2 };

  // Finally sync bond amount to 0 in OptimisticOracleV3.
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", forkProvider);
  const identifier = await og.identifier();
  const simulation3 = await simulateTenderlyTx(
    {
      chainId,
      from: Wallet.createRandom().address,
      to: oo.address,
      input: oo.interface.encodeFunctionData("syncUmaParams", [identifier, collateralAddress]),
      fork: { id: fork.id, root: simulation2.id },
      description: "Sync bond to 0 in OptimisticOracleV3",
    },
    retryOptions
  );
  if (!simulation3.status) return { forkUrl, lastSimulation: simulation3 };

  // Propose transactions.
  const transactions = proposal.safe.txs.map((tx) => tx.mainTransaction);
  const simulation4 = await simulateTenderlyTx(
    {
      chainId,
      from: Wallet.createRandom().address,
      to: proposal.safe.umaAddress,
      input: og.interface.encodeFunctionData("proposeTransactions", [transactions, utils.toUtf8Bytes(proposal.ipfs)]),
      fork: { id: fork.id, root: simulation3.id },
      description: "Propose transactions",
    },
    retryOptions
  );
  if (!simulation4.status) return { forkUrl, lastSimulation: simulation4 };

  // Execute proposal after challenge window ends.
  const currentTimestamp = await getBlockTimestamp(forkProvider, await forkProvider.getBlockNumber());
  const challengeWindowEndTimestamp = currentTimestamp + (await og.liveness()).toNumber();
  const simulation5 = await simulateTenderlyTx(
    {
      chainId,
      from: Wallet.createRandom().address,
      to: proposal.safe.umaAddress,
      input: og.interface.encodeFunctionData("executeProposal", [transactions]),
      timestampOverride: challengeWindowEndTimestamp,
      fork: { id: fork.id, root: simulation4.id },
      description: "Execute proposal",
    },
    retryOptions
  );
  return { forkUrl, lastSimulation: simulation5 };
};
