import { interfaceName } from "../../Constants";
import { task } from "hardhat/config";
import { Contract } from "web3-eth-contract";
import { CombinedHRE } from "./types";
import { GovernorV2RolesEnum, TokenRolesEnum } from "../../Enums";
import Web3 from "web3";
const { padRight, utf8ToHex } = Web3.utils;

type InterfaceName = keyof typeof interfaceName;
function isInterfaceName(name: string): name is InterfaceName {
  return name in interfaceName;
}

const registeredContracts = new Set([
  "OptimisticOracle",
  "OptimisticOracleV2",
  "OptimisticOracleV3",
  "SkinnyOptimisticOracle",
  "SkinnyOptimisticOracleV2",
  "GovernorV2",
  "ProposerV2",
]);

// Gets all contract deployments that can be added to the Finder.
async function getContractsForFinder(hre_: CombinedHRE, mockOracle: boolean) {
  const { deployments, web3 } = hre_;

  const supportedFinderContracts = Object.keys(interfaceName);
  const contractsForFinder = new Map<InterfaceName, Contract>();

  for (const contractName of supportedFinderContracts) {
    if (!isInterfaceName(contractName)) throw new Error(`No mapped interface name for contract name ${contractName}`);

    // Depending on mockOracle flag skip either VotingV2 or MockOracleAncillary
    if (mockOracle && contractName === "VotingV2") continue;
    if (!mockOracle && contractName === "MockOracleAncillary") continue;

    try {
      const deployed = await deployments.get(contractName);
      contractsForFinder.set(contractName, new web3.eth.Contract(deployed.abi, deployed.address));
    } catch {
      // Do nothing if network does not have this contract deployed.
    }
  }

  return contractsForFinder;
}

// Gets all contract deployments that can be added to the Registry.
async function getContractsForRegistry(hre_: CombinedHRE) {
  const { deployments } = hre_;

  const contractsForRegistry = new Map<string, string>();

  for (const contractName of registeredContracts) {
    try {
      const deployed = await deployments.get(contractName);
      contractsForRegistry.set(contractName, deployed.address);
    } catch {
      // Do nothing if network does not have this contract deployed.
    }
  }

  return contractsForRegistry;
}

task("setup-dvmv2-testnet", "Configures DVMv2 on L1 testnet")
  .addFlag("mockoracle", "Use if you want to set MockOracleAncillary as the Oracle")
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { mockoracle } = taskArguments;

    /** ***********************************
     * Adding contracts to Finder
     *************************************/

    const Finder = await deployments.get("Finder");
    const finder = new web3.eth.Contract(Finder.abi, Finder.address);
    console.log(`Using Finder @ ${finder.options.address}`);

    const contractsForFinder = await getContractsForFinder(hre, !!mockoracle);
    for (const [contractName, contract] of contractsForFinder) {
      const nameInFinder = interfaceName[contractName];

      const identifierHex = padRight(utf8ToHex(nameInFinder), 64);
      const currentlySetAddress = await finder.methods.interfacesImplemented(identifierHex).call();
      if (currentlySetAddress !== contract.options.address) {
        const txn = await finder.methods
          .changeImplementationAddress(identifierHex, contract.options.address)
          .send({ from: deployer });
        console.log(
          `Set ${contractName} in Finder to "${nameInFinder}" @ ${contract.options.address}, tx: ${txn.transactionHash}`
        );
      } else {
        console.log(`Already set ${contractName} in Finder to "${nameInFinder}" @ ${contract.options.address}`);
      }
    }

    /** ***********************************
     * Adding contracts to Registry
     *************************************/

    const contractsForRegistry = await getContractsForRegistry(hre);
    for (const [contractName, account] of contractsForRegistry) {
      console.log(`Trying to add ${contractName} to Registry`);
      await hre.run("register-accounts", { account });
    }

    /** ***********************************
     * Adding minter role for VotingV2
     *************************************/

    const VotingToken = await deployments.get("VotingToken");
    const votingToken = new web3.eth.Contract(VotingToken.abi, VotingToken.address);
    console.log(`Using VotingToken @ ${votingToken.options.address}`);

    const VotingV2 = await deployments.get("VotingV2");

    const hasMinterRole = await votingToken.methods.holdsRole(TokenRolesEnum.MINTER, VotingV2.address).call();
    if (!hasMinterRole) {
      const txn = await votingToken.methods.addMember(TokenRolesEnum.MINTER, VotingV2.address).send({ from: deployer });
      console.log(`Added token minter role to VotingV2 @ ${VotingV2.address}, tx: ${txn.transactionHash}`);
    } else {
      console.log(`VotingV2 @ ${VotingV2.address} already has token minter role`);
    }

    /** ***********************************
     * Transferring VotingV2 ownership to GovernorV2
     *************************************/

    const votingV2 = new web3.eth.Contract(VotingV2.abi, VotingV2.address);
    console.log(`Using VotingV2 @ ${votingV2.options.address}`);

    const GovernorV2 = await deployments.get("GovernorV2");

    const currentOwner = await votingV2.methods.owner().call();
    if (currentOwner !== GovernorV2.address) {
      const txn = await votingV2.methods.transferOwnership(GovernorV2.address).send({ from: deployer });
      console.log(`Set VotingV2 owner to GovernorV2 @ ${GovernorV2.address}, tx: ${txn.transactionHash}`);
    } else {
      console.log(`VotingV2 @ ${VotingV2.address} already owned by GovernorV2`);
    }

    /** ***********************************
     * Setting up roles for GovernorV2
     *************************************/

    const governorV2 = new web3.eth.Contract(GovernorV2.abi, GovernorV2.address);
    console.log(`Using GovernorV2 @ ${governorV2.options.address}`);

    const ProposerV2 = await deployments.get("ProposerV2");
    const hasProposerRole = await governorV2.methods.holdsRole(GovernorV2RolesEnum.PROPOSER, ProposerV2.address).call();
    if (!hasProposerRole) {
      const txn = await governorV2.methods
        .resetMember(GovernorV2RolesEnum.PROPOSER, ProposerV2.address)
        .send({ from: deployer });
      console.log(`Reset proposer role to ProposerV2 @ ${ProposerV2.address}, tx: ${txn.transactionHash}`);
    } else {
      console.log(`ProposerV2 @ ${ProposerV2.address} already has proposer role`);
    }

    const EmergencyProposer = await deployments.get("EmergencyProposer");
    const hasEmergencyProposerRole = await governorV2.methods
      .holdsRole(GovernorV2RolesEnum.EMERGENCY_PROPOSER, EmergencyProposer.address)
      .call();
    if (!hasEmergencyProposerRole) {
      const txn = await governorV2.methods
        .resetMember(GovernorV2RolesEnum.EMERGENCY_PROPOSER, EmergencyProposer.address)
        .send({ from: deployer });
      console.log(
        `Reset emergency proposer role to EmergencyProposer @ ${EmergencyProposer.address}, tx: ${txn.transactionHash}`
      );
    } else {
      console.log(`EmergencyProposer @ ${EmergencyProposer.address} already has emergency proposer role`);
    }

    /** ***********************************
     * Sync OptimisticOracleV3
     *************************************/

    // If Oracle was changed OptimisticOracleV3 requires syncing its cached values. We do this only if already have
    // deployed OptimisticOracleV3 for the network.
    try {
      const OptimisticOracleV3 = await deployments.get("OptimisticOracleV3");
      const optimisticOraclev3 = new web3.eth.Contract(OptimisticOracleV3.abi, OptimisticOracleV3.address);
      console.log(`Using OptimisticOracleV3 @ ${optimisticOraclev3.options.address}`);

      const defaultIdentifier = await optimisticOraclev3.methods.defaultIdentifier().call();
      const defaultCurrency = await optimisticOraclev3.methods.defaultCurrency().call();
      const txn = await optimisticOraclev3.methods
        .syncUmaParams(defaultIdentifier, defaultCurrency)
        .send({ from: deployer });
      console.log(`Synced OptimisticOracleV3 cached params, tx: ${txn.transactionHash}`);
    } catch {
      console.log("OptimisticOracleV3 not deployed for this network");
    }
  });
