const hre = require("hardhat");
import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { ZERO_ADDRESS } from "@uma/common";
const { getContractFactory } = hre.ethers;
const assert = require("assert").strict;

import {
  FinderEthers,
  getAddress,
  GovernorEthers,
  ProposerEthers,
  VotingEthers,
  VotingUpgraderV2Ethers,
  VotingUpgraderV2Ethers__factory,
} from "@uma/contracts-node";

export const NEW_CONTRACTS = {
  governor: "GOVERNOR_V2_ADDRESS",
  proposer: "PROPOSER_V2_ADDRESS",
  voting: "VOTING_V2_ADDRESS",
};

export const OLD_CONTRACTS = {
  governor: "GOVERNOR_ADDRESS",
  proposer: "PROPOSER_ADDRESS",
  voting: "VOTING_ADDRESS",
};

export const VOTING_UPGRADER_ADDRESS = "VOTING_UPGRADER_ADDRESS";

export const TEST_DOWNGRADE = "TEST_DOWNGRADE";

export interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}
export interface OwnableContracts {
  identifierWhitelist: string;
  financialContractsAdmin: string;
  addressWhitelist: string;
  governorRootTunnel: string;
  arbitrumParentMessenger: string;
  oracleHub: string;
  governorHub: string;
  bobaParentMessenger: string;
  optimismParentMessenger: string;
}

export const getOwnableContracts = async (networkId: number): Promise<OwnableContracts> => {
  return {
    identifierWhitelist: await getAddress("IdentifierWhitelist", networkId),
    financialContractsAdmin: await getAddress("FinancialContractsAdmin", networkId),
    addressWhitelist: await getAddress("AddressWhitelist", networkId),
    governorRootTunnel: await getAddress("GovernorRootTunnel", networkId),
    arbitrumParentMessenger: await getAddress("Arbitrum_ParentMessenger", networkId),
    oracleHub: await getAddress("OracleHub", networkId),
    governorHub: await getAddress("GovernorHub", networkId),
    bobaParentMessenger: await getAddress("Boba_ParentMessenger", networkId),
    optimismParentMessenger: await getAddress("Optimism_ParentMessenger", networkId),
  };
};

export interface MultiRoleContracts {
  registry: string;
  store: string;
}

export const getMultiRoleContracts = async (networkId: number): Promise<MultiRoleContracts> => {
  return {
    registry: await getAddress("Registry", networkId),
    store: await getAddress("Store", networkId),
  };
};

export const checkEnvVariables = (): void => {
  // mandatory variables
  Object.values(NEW_CONTRACTS).forEach((element) => {
    if (!process.env[element]) throw new Error(`${element} not set`);
  });

  // optional variables
  // if any of these are set, then all of them must be set
  if (Object.values(OLD_CONTRACTS).find((element) => process.env[element])) {
    Object.values(OLD_CONTRACTS).forEach((element) => {
      if (!process.env[element]) throw new Error(`${element} not set`);
    });
  }

  // Downgrade related logic
  if (process.env[TEST_DOWNGRADE] && process.env[VOTING_UPGRADER_ADDRESS])
    throw new Error("VOTING_UPGRADER_ADDRESS should not be set during a test downgrade");
};

export const deployVotingUpgraderAndRunDowngradeOptionalTx = async (
  adminProposalTransactions: AdminProposalTransaction[],
  governor: GovernorEthers,
  governorV2: GovernorEthers,
  proposer: ProposerEthers,
  proposerV2: ProposerEthers,
  votingV2: VotingEthers,
  oldVoting: VotingEthers,
  finder: FinderEthers,
  ownableContractsToMigrate: OwnableContracts,
  multicallContractsToMigrate: MultiRoleContracts
): Promise<VotingUpgraderV2Ethers> => {
  // This shouldn't be executed if not in test mode
  assert(process.env[TEST_DOWNGRADE], "Not in test mode");

  console.log("1.1 TEST MODE: DEPLOYING VOTING UPGRADER");
  const votingUpgraderFactoryV2: VotingUpgraderV2Ethers__factory = await getContractFactory("VotingUpgraderV2");
  const votingUpgrader = await votingUpgraderFactoryV2.deploy(
    governor.address,
    governorV2.address,
    oldVoting.address,
    votingV2.address,
    proposer.address,
    finder.address,
    ownableContractsToMigrate,
    multicallContractsToMigrate
  );
  const votingUpgraderAddress = votingUpgrader.address;
  console.log("Voting Upgrader deployed to:", votingUpgraderAddress);

  // If votingV2 is already migrated, remove it
  const migratedAddress = await votingV2.migratedAddress();
  if (migratedAddress != ZERO_ADDRESS) {
    console.log("1.2 TEST MODE: UNSETTING MIGRATED ADDRESS IN VOTING V2");
    const migrateTx = await votingV2.populateTransaction.setMigrated(ZERO_ADDRESS);
    if (!migrateTx.data) throw "migrateTx.data is null";
    adminProposalTransactions.push({ to: votingV2.address, value: 0, data: migrateTx.data });
    console.log("Unsetting migrated address:", migrateTx.data);
  }

  const votingV2Owner = await votingV2.owner();

  if (votingV2Owner !== governorV2.address) {
    if (governor.address == votingV2Owner) {
      console.log("1.3 TEST MODE: TRANSFERRING OWNERSHIP OF NEW VOTING TO GOVERNORV2");
      const transferOwnershipTx = await votingV2.populateTransaction.transferOwnership(governorV2.address);
      if (!transferOwnershipTx.data) throw "transferOwnershipTx.data is null";
      adminProposalTransactions.push({ to: votingV2.address, value: 0, data: transferOwnershipTx.data });
      console.log("Transfer VotingV2 ownership to GovernorV2:", transferOwnershipTx.data);
    }
  }

  const proposerV2Owner = await proposerV2.owner();
  if (proposerV2Owner !== governorV2.address) {
    if (!process.env[TEST_DOWNGRADE]) throw new Error();
    if (governor.address == proposerV2Owner) {
      console.log("1.4 TEST MODE: TRANSFERRING OWNERSHIP OF NEW PROPOSER TO NEW GOVERNOR");
      const transferOwnershipTx = await proposerV2.populateTransaction.transferOwnership(governorV2.address);
      if (!transferOwnershipTx.data) throw "transferOwnershipTx.data is null";
      adminProposalTransactions.push({ to: proposerV2.address, value: 0, data: transferOwnershipTx.data });
      console.log("Transfering proposer v2 ownership to governorV2:", transferOwnershipTx.data);
    }
  }

  return votingUpgrader;
};

export const isContractInstance = async (address: string, functionSignature: string): Promise<boolean> => {
  const code = await hre.ethers.provider.getCode(address);
  const encodedSignature = hre.web3.eth.abi.encodeFunctionSignature(functionSignature).slice(2);
  return code.includes(encodedSignature);
};
