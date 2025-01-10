import "@nomiclabs/hardhat-ethers";
import hre from "hardhat";

import { Provider } from "@ethersproject/abstract-provider";

import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";

import {
  getAddress as _getAddress,
  GovernorChildTunnelEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  GovernorSpokeEthers,
  ParentMessengerBaseEthers,
} from "@uma/contracts-node";
import { PopulatedTransaction, Signer, Wallet } from "ethers";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";
import { decodeRelayMessages, fundArbitrumParentMessengerForRelays, relayGovernanceMessages } from "../../utils/relay";

import { getGckmsSigner, getRetryProvider } from "@uma/common";

import { strict as assert } from "assert";

import { IdentifierWhitelist } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { ParamType } from "ethers/lib/utils";
import { forkNetwork } from "../../utils/utils";

const getAddress = (contractName: string, networkId: number): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _getAddress(contractName as any, networkId);
};

const supportedNetworks = ["mainnet", "polygon", "arbitrum", "optimism", "base", "blast"] as const;
type SupportedNetwork = typeof supportedNetworks[number];

const networksNumber: Record<SupportedNetwork, number> = {
  mainnet: 1,
  polygon: 137,
  optimism: 10,
  arbitrum: 42161,
  base: 8453,
  blast: 81457,
};

function isSupportedNetwork(key: string): key is SupportedNetwork {
  return supportedNetworks.includes(key as any);
}

const getConnectedIdentifierWhitelist = async (chainId: number): Promise<IdentifierWhitelist> =>
  getContractInstanceWithProvider<IdentifierWhitelist>("IdentifierWhitelist", getRetryProvider(chainId));

export {
  assert,
  BigNumberish,
  BytesLike,
  decodeRelayMessages,
  forkNetwork,
  fundArbitrumParentMessengerForRelays,
  getAddress,
  getConnectedIdentifierWhitelist,
  getContractInstance,
  getGckmsSigner,
  GovernorChildTunnelEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  GovernorSpokeEthers,
  hre,
  isSupportedNetwork,
  networksNumber,
  ParamType,
  ParentMessengerBaseEthers,
  PopulatedTransaction,
  Provider,
  relayGovernanceMessages,
  Signer,
  supportedNetworks,
  Wallet,
};
