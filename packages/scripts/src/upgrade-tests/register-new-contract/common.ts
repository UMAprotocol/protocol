import "@nomiclabs/hardhat-ethers";
import hre from "hardhat";

import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";

import {
  FinderEthers,
  GovernorChildTunnelEthers,
  GovernorEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  GovernorSpokeEthers,
  OptimisticAsserterEthers,
  ParentMessengerBaseEthers,
  ProposerEthers,
  RegistryEthers,
  getAddress as _getAddress,
} from "@uma/contracts-node";
import { BaseContract, PopulatedTransaction, Signer } from "ethers";
import { getContractInstance, getContractInstanceByUrl } from "../../utils/contracts";
import {
  fundArbitrumParentMessengerForRelays,
  relayGovernanceMessages,
  decodeData,
  decodeRelayMessages,
  ProposedTransaction,
  RelayTransaction,
} from "../../utils/relay";

import { interfaceName, RegistryRolesEnum } from "@uma/common";

import { strict as assert } from "assert";

import { ParamType } from "ethers/lib/utils";
import { forkNetwork } from "../../utils/utils";

const getAddress = (contractName: string, networkId: number): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _getAddress(contractName as any, networkId);
};

const newContractName = interfaceName.OptimisticAsserter;

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
  OptimisticAsserterEthers,
  forkNetwork,
  ParamType,
};
