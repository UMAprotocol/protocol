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
};
