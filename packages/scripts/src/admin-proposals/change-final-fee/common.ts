import "@nomiclabs/hardhat-ethers";
import { ContractName, DeploymentName } from "@uma/contracts-node";
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
import { getContractInstance, getContractInstanceByUrl } from "../../utils/contracts";
import {
  decodeData,
  decodeRelayMessages,
  fundArbitrumParentMessengerForRelays,
  ProposedTransaction,
  relayGovernanceMessages,
  RelayTransaction,
} from "../../utils/relay";

import { getGckmsSigner, interfaceName, RegistryRolesEnum } from "@uma/common";

import { strict as assert } from "assert";

import { ParamType } from "ethers/lib/utils";
import { forkNetwork } from "../../utils/utils";

const getAddress = (contractName: string, networkId: number): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _getAddress(contractName as any, networkId);
};

const newContractName = interfaceName.OptimisticOracleV3 as ContractName | DeploymentName;

const tokensToUpdateFee = {
  USDC: {
    mainnet: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    polygon: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    arbitrum: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
    optimism: "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
  },
  USDT: {
    mainnet: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    polygon: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    arbitrum: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    optimism: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
  },
  DAI: {
    mainnet: "0x6b175474e89094c44da98b954eedeac495271d0f",
    polygon: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
    arbitrum: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    optimism: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  },
  WETH: {
    mainnet: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    polygon: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    arbitrum: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    optimism: "0x4200000000000000000000000000000000000006",
  },
};

export {
  hre,
  interfaceName,
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
  tokensToUpdateFee,
};
