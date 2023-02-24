import { addGlobalHardhatTestingAddress, ZERO_ADDRESS } from "@uma/common";
import {
  EmergencyProposerEthers,
  FixedSlashSlashingLibraryEthers,
  GovernorV2Ethers,
  ProposerV2Ethers,
  VotingV2Ethers,
} from "@uma/contracts-node";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import {
  baseSlashAmount,
  emergencyQuorum,
  emissionRate,
  gat,
  governanceProposalBond,
  governanceSlashAmount,
  governorStartingId,
  maxRequestsPerRound,
  maxRolls,
  minimumWaitTime,
  phaseLength,
  spat,
  totalSupply,
  unstakeCooldown,
} from "../constants";
import { formatBytes32String, getContractFactory, hre, Signer } from "../utils";

export interface DVM2Contracts {
  votingV2: VotingV2Ethers;
  governorV2: GovernorV2Ethers;
  proposerV2: ProposerV2Ethers;
  emergencyProposer: EmergencyProposerEthers;
}

export const dvm2Fixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<DVM2Contracts> => {
    return await deployDVM2(ethers);
  }
);

export const deployDVM2 = hre.deployments.createFixture(
  async ({ ethers }): Promise<DVM2Contracts> => {
    // Signer from ethers and hardhat-ethers are not version compatible.
    const [deployer] = (await ethers.getSigners()) as Signer[];
    const deployerAddress = await deployer.getAddress();

    // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
    // deployments that follows.
    const parentFixture = await umaEcosystemFixture();

    // Deploy slashing library.
    const slashingLibrary = (await (await getContractFactory("FixedSlashSlashingLibrary", deployer)).deploy(
      baseSlashAmount,
      governanceSlashAmount
    )) as FixedSlashSlashingLibraryEthers;

    // Deploying VotingV2 contract requires minting voting tokens for GAT validation.
    await parentFixture.votingToken.addMinter(deployerAddress);
    await parentFixture.votingToken.mint(deployerAddress, totalSupply);
    const votingV2 = (await (await getContractFactory("VotingV2", deployer)).deploy(
      emissionRate,
      unstakeCooldown,
      phaseLength,
      maxRolls,
      maxRequestsPerRound,
      gat,
      spat,
      parentFixture.votingToken.address,
      parentFixture.finder.address,
      slashingLibrary.address,
      ZERO_ADDRESS
    )) as VotingV2Ethers;

    // Deploy GovernorV2 contract.
    const governorV2 = (await (await getContractFactory("GovernorV2", deployer)).deploy(
      parentFixture.finder.address,
      governorStartingId
    )) as GovernorV2Ethers;

    // Deploy ProposerV2 contract.
    const proposerV2 = (await (await getContractFactory("ProposerV2", deployer)).deploy(
      parentFixture.votingToken.address,
      governanceProposalBond,
      governorV2.address,
      parentFixture.finder.address
    )) as ProposerV2Ethers;

    // Deploy EmergencyProposer contract.
    const emergencyProposer = (await (await getContractFactory("EmergencyProposer", deployer)).deploy(
      parentFixture.votingToken.address,
      emergencyQuorum,
      governorV2.address,
      await deployer.getAddress(),
      minimumWaitTime
    )) as EmergencyProposerEthers;

    // Configure GovernorV2 contract.
    await governorV2.resetMember(1, proposerV2.address);
    await governorV2.resetMember(2, emergencyProposer.address);

    // Transfer VotingV2 ownership and register it as Oracle with the Finder.
    await votingV2.transferOwnership(governorV2.address);
    await parentFixture.finder.changeImplementationAddress(formatBytes32String("Oracle"), votingV2.address);

    // Add contracts to global hardhatTestingAddresses.
    addGlobalHardhatTestingAddress("VotingV2", votingV2.address);
    addGlobalHardhatTestingAddress("GovernorV2", governorV2.address);
    addGlobalHardhatTestingAddress("ProposerV2", proposerV2.address);
    addGlobalHardhatTestingAddress("EmergencyProposer", emergencyProposer.address);

    return { votingV2, governorV2, proposerV2, emergencyProposer };
  }
);
