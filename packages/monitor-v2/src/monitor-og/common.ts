import {
  ContractAddresses as zodiacContractAddresses,
  SupportedNetworks as zodiacSupportedNetworks,
} from "@gnosis.pm/zodiac";
import { getRetryProvider } from "@uma/common";
import { ERC20Ethers, getAddress, ModuleProxyFactoryEthers } from "@uma/contracts-node";
import { ModuleProxyCreationEvent } from "@uma/contracts-node/typechain/core/ethers/ModuleProxyFactory";
import { delay } from "@uma/financial-templates-lib";
import { Contract, Event, EventFilter, utils } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "./common";

import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { constants as ethersConstants } from "ethers";
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
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  ogAddress: string;
  moduleProxyFactoryAddresses: string[];
  ogMasterCopyAddresses: string[];
  provider: Provider;
  chainId: number;
  blockRange: BlockRange;
  pollingDelay: number;
  botModes: BotModes;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.OG_ADDRESS) throw new Error("OG_ADDRESS must be defined in env");
  const ogAddress = String(env.OG_ADDRESS);

  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // If no module proxy factory addresses are provided, default to the latest version of zodiac factory address if
  // chainId is supported. This can be empty if bot config does not require monitoring proxy deployments.
  const fallbackModuleProxyFactoryAddresses = Object.values(zodiacSupportedNetworks).includes(chainId)
    ? [zodiacContractAddresses[chainId as zodiacSupportedNetworks].factory]
    : [];
  const moduleProxyFactoryAddresses: string[] = env.MODULE_PROXY_FACTORY_ADDRESSES
    ? JSON.parse(env.MODULE_PROXY_FACTORY_ADDRESSES)
    : fallbackModuleProxyFactoryAddresses;

  // If no OG mastercopy addresses are provided, default to the protocol deployment address if chainId is supported.
  // This can be empty if bot config does not require monitoring proxy deployments.
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
  const provider = getRetryProvider(chainId) as Provider;

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
  };

  // If monitoring proxy deployements is enabled, ensure that the required env variables are set.
  if (botModes.proxyDeployedEnabled && ogMasterCopyAddresses.length === 0) {
    throw new Error("OG_MASTER_COPY_ADDRESSES must be set in env if PROXY_DEPLOYED_ENABLED is true");
  }
  if (botModes.proxyDeployedEnabled && moduleProxyFactoryAddresses.length === 0) {
    throw new Error("MODULE_PROXY_FACTORY_ADDRESSES must be set in env if PROXY_DEPLOYED_ENABLED is true");
  }

  return {
    ogAddress,
    moduleProxyFactoryAddresses,
    ogMasterCopyAddresses,
    provider,
    chainId,
    blockRange: { start: startingBlock, end: endingBlock },
    pollingDelay,
    botModes,
  };
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

export const getOg = async (params: MonitoringParams): Promise<OptimisticGovernorEthers> => {
  return await getContractInstanceWithProvider<OptimisticGovernorEthers>(
    "OptimisticGovernor",
    params.provider,
    params.ogAddress
  );
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
  const moduleProxyFactories = [];
  for (const moduleProxyFactoryAddress of params.moduleProxyFactoryAddresses) {
    moduleProxyFactories.push(
      await getContractInstanceWithProvider<ModuleProxyFactoryEthers>(
        "ModuleProxyFactory",
        params.provider,
        moduleProxyFactoryAddress
      )
    );
  }
  const transactions = (
    await Promise.all(
      moduleProxyFactories.map(
        async (moduleProxyFactory) =>
          await Promise.all(
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
