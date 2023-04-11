const hre = require("hardhat");
import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { ZERO_ADDRESS } from "@uma/common";
const { getContractFactory } = hre.ethers;
const assert = require("assert").strict;

import {
  EmergencyProposerEthers,
  FinderEthers,
  getAddress,
  GovernorEthers,
  ProposerEthers,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers,
  VotingUpgraderV2Ethers__factory,
} from "@uma/contracts-node";
import { REQUIRED_SIGNER_ADDRESSES } from "../../utils/constants";
import { getContractInstance } from "../../utils/contracts";

export const NEW_CONTRACTS = {
  governor: "GOVERNOR_V2_ADDRESS",
  proposer: "PROPOSER_V2_ADDRESS",
  voting: "VOTING_V2_ADDRESS",
  emergencyProposer: "EMERGENCY_PROPOSER_ADDRESS",
};

export const OLD_CONTRACTS = {
  governor: "GOVERNOR_ADDRESS",
  proposer: "PROPOSER_ADDRESS",
  voting: "VOTING_ADDRESS",
};

export const VOTING_UPGRADER_ADDRESS = "VOTING_UPGRADER_ADDRESS";

export const TEST_DOWNGRADE = "TEST_DOWNGRADE";

export const EMERGENCY_PROPOSAL = "EMERGENCY_PROPOSAL";

export const EMERGENCY_EXECUTOR = "EMERGENCY_EXECUTOR";

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
  optimisticOracleV3: string;
}

export const formatIndentation = (str: string): string => str.replace(/  +/g, "");

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
    optimisticOracleV3: await getAddress("OptimisticOracleV3", networkId),
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

  // emergency executor
  if (!process.env[EMERGENCY_EXECUTOR]) throw new Error(`${EMERGENCY_EXECUTOR} not set`);

  // Downgrade related logic
  if (process.env[TEST_DOWNGRADE] && process.env[VOTING_UPGRADER_ADDRESS])
    throw new Error("VOTING_UPGRADER_ADDRESS should not be set during a test downgrade");
};

export const deployVotingUpgraderAndRunDowngradeOptionalTx = async (
  upgraderWallet: string,
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
    upgraderWallet,
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

export const isGovernorV2Instance = async (address: string): Promise<boolean> => {
  return isContractInstance(address, "propose((address,uint256,bytes)[],bytes)");
};

export const isProposerV1Instance = async (address: string): Promise<boolean> => {
  return isContractInstance(address, "propose((address,uint256,bytes)[])");
};

export const isVotingV2Instance = async (address: string): Promise<boolean> => {
  return await isContractInstance(address, "stake(uint128)");
};

export const proposeEmergency = async (
  emergencyProposerAddress: string,
  votingToken: VotingTokenEthers,
  adminProposalTransactions: AdminProposalTransaction[]
): Promise<void> => {
  const signer = await hre.ethers.getSigner(REQUIRED_SIGNER_ADDRESSES.foundation);

  const emergencyProposer = await getContractInstance<EmergencyProposerEthers>(
    "EmergencyProposer",
    emergencyProposerAddress
  );
  const emergencyProposeBond = await emergencyProposer.quorum();
  const allowance = await votingToken.allowance(await signer.getAddress(), emergencyProposer.address);
  if (allowance.lt(emergencyProposeBond)) {
    console.log("Approving emergency proposer bond");
    const approveTx = await votingToken.connect(signer).approve(emergencyProposer.address, emergencyProposeBond);
    await approveTx.wait();
  }
  console.log("SENDING PROPOSAL TXS TO EMERGENCY PROPOSER");
  await emergencyProposer.connect(signer).emergencyPropose(adminProposalTransactions);
  console.log("Proposal done!🎉");
  console.log("\n❓ OPTIONAL: Simulate and execute the emergency proposal with the following command: ");
  console.log(
    formatIndentation(
      `
  ${NEW_CONTRACTS.emergencyProposer}=${process.env[NEW_CONTRACTS.emergencyProposer]} \\
  ${EMERGENCY_EXECUTOR}=${process.env[EMERGENCY_EXECUTOR]} \\
  yarn hardhat run ./src/admin-proposals/simulateEmergencyProposal.ts --network ${hre.network.name}`
    )
  );
};
