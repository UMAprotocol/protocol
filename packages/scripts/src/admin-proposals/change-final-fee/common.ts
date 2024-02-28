import "@nomiclabs/hardhat-ethers";
import { AddressWhitelistEthers, ContractName, DeploymentName, StoreEthers } from "@uma/contracts-node";
import hre from "hardhat";

import { Provider } from "@ethersproject/abstract-provider";

import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";

import {
  FinderEthers,
  getAddress as _getAddress,
  GovernorChildTunnelEthers,
  GovernorEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  GovernorSpokeEthers,
  OptimisticOracleV3Ethers,
  ParentMessengerBaseEthers,
  ProposerEthers,
  RegistryEthers,
} from "@uma/contracts-node";
import { BaseContract, PopulatedTransaction, Signer, Wallet } from "ethers";
import { getContractInstance, getContractInstanceByUrl, getContractInstanceWithProvider } from "../../utils/contracts";
import {
  decodeData,
  decodeRelayMessages,
  fundArbitrumParentMessengerForRelays,
  ProposedTransaction,
  relayGovernanceMessages,
  RelayTransaction,
} from "../../utils/relay";

import { getGckmsSigner, getRetryProvider, interfaceName, RegistryRolesEnum } from "@uma/common";

import { strict as assert } from "assert";

import { ParamType } from "ethers/lib/utils";
import { forkNetwork } from "../../utils/utils";

const getAddress = (contractName: string, networkId: number): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _getAddress(contractName as any, networkId);
};

const newContractName = interfaceName.OptimisticOracleV3 as ContractName | DeploymentName;

const supportedNetworks = ["mainnet", "polygon", "arbitrum", "optimism"] as const;
type SupportedNetwork = typeof supportedNetworks[number];

const networksNumber: Record<SupportedNetwork, number> = {
  mainnet: 1,
  polygon: 137,
  optimism: 10,
  arbitrum: 42161,
};

function isSupportedNetwork(key: string): key is SupportedNetwork {
  return supportedNetworks.includes(key as any);
}

interface TokensConfig {
  [token: string]: {
    finalFee: string;
  } & {
    [network in SupportedNetwork]?: string;
  };
}

function parseAndValidateTokensConfig(jsonString: string | undefined): TokensConfig {
  let config: any;
  try {
    if (!jsonString) throw new Error("Missing JSON string");
    config = JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Invalid JSON format");
  }

  // Validate the structure of the config
  for (const [token, tokenConfig] of Object.entries(config)) {
    if (typeof token !== "string" || typeof tokenConfig !== "object" || tokenConfig === null) {
      throw new Error(`Invalid format for token '${token}'`);
    }

    if (!("finalFee" in tokenConfig) || typeof tokenConfig.finalFee !== "string") {
      throw new Error(`Missing or invalid 'finalFee' for token '${token}'`);
    }

    for (const network in tokenConfig) {
      if (network !== "finalFee" && !isSupportedNetwork(network)) {
        throw new Error(`Unsupported network '${network}' in token '${token}'`);
      }
    }
  }

  return config as TokensConfig;
}

const getConnectedAddressWhitelist = async (chainId: number): Promise<AddressWhitelistEthers> =>
  getContractInstanceWithProvider<AddressWhitelistEthers>("AddressWhitelist", getRetryProvider(chainId));

const getConnectedStore = async (chainId: number): Promise<StoreEthers> =>
  getContractInstanceWithProvider<StoreEthers>("Store", getRetryProvider(chainId));

export {
  hre,
  interfaceName,
  parseAndValidateTokensConfig,
  getConnectedAddressWhitelist,
  getConnectedStore,
  TokensConfig,
  supportedNetworks,
  isSupportedNetwork,
  networksNumber,
  newContractName,
  getContractInstance,
  getContractInstanceByUrl,
  fundArbitrumParentMessengerForRelays,
  relayGovernanceMessages,
  getAddress,
  RegistryRolesEnum,
  BigNumberish,
  BytesLike,
  FinderEthers,
  GovernorEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  ParentMessengerBaseEthers,
  ProposerEthers,
  RegistryEthers,
  BaseContract,
  PopulatedTransaction,
  Signer,
  assert,
  decodeData,
  decodeRelayMessages,
  ProposedTransaction,
  RelayTransaction,
  GovernorChildTunnelEthers,
  GovernorSpokeEthers,
  OptimisticOracleV3Ethers,
  forkNetwork,
  ParamType,
  Provider,
  getGckmsSigner,
  Wallet,
};
