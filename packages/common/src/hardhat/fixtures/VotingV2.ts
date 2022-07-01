import { HardhatRuntimeEnvironment } from "hardhat/types";
import { interfaceName } from "../../Constants";
import { RegistryRolesEnum } from "../../Enums";
import { CombinedHRE } from "../tasks/types";
import { DeploymentsExtension } from "hardhat-deploy/types";

const defaultFixtureWhitelist = [
  "VotingToken",
  "FinancialContractsAdmin",
  "Finder",
  "dvmv2",
  "Registry",
  "Store",
  "IdentifierWhitelist",
  "AddressWhitelist",
];

export async function runVotingV2Fixture(
  { deployments }: { deployments: DeploymentsExtension },
  runInitialDeployment = true
): Promise<void> {
  const setup = deployments.createFixture(async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, web3 } = hre as CombinedHRE; // Cast because hardhat extension isn't well-typed.
    const { padRight, toWei, utf8ToHex } = web3.utils;
    if (runInitialDeployment) await deployments.fixture(defaultFixtureWhitelist);
    const { deployer } = await getNamedAccounts();

    const getDeployment = async (name: string) => {
      const contract = await deployments.get(name);
      return new web3.eth.Contract(contract.abi, contract.address);
    };

    // Setup finder.
    const finder = await getDeployment("Finder");

    const addToFinder = async (deploymentName: string, finderName: string) => {
      const { address } = await deployments.get(deploymentName);
      const hexName = padRight(utf8ToHex(finderName), 64);
      await finder.methods.changeImplementationAddress(hexName, address).send({ from: deployer });
    };

    await addToFinder("FinancialContractsAdmin", interfaceName.FinancialContractsAdmin);
    await addToFinder("VotingV2", interfaceName.Oracle);
    await addToFinder("Registry", interfaceName.Registry);
    await addToFinder("Store", interfaceName.Store);
    await addToFinder("IdentifierWhitelist", interfaceName.IdentifierWhitelist);
    await addToFinder("AddressWhitelist", interfaceName.CollateralWhitelist);

    // Setup token.
    const votingToken = await getDeployment("VotingToken");
    const minterRoleEnumValue = 1;
    await votingToken.methods.addMember(minterRoleEnumValue, deployer).send({ from: deployer });
    await votingToken.methods.mint(deployer, toWei("100000000")).send({ from: deployer });
    await votingToken.methods.removeMember(minterRoleEnumValue, deployer).send({ from: deployer });

    // Set the minter to be the Voting contract.
    const { address: votingAddress } = await deployments.get("VotingV2");
    await votingToken.methods.addMember(minterRoleEnumValue, votingAddress).send({ from: deployer });

    // Setup Registry.
    const registry = await getDeployment("Registry");

    // Add pre-registered contracts.
    const { address: governorAddress } = await deployments.get("GovernorV2");
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer).send({ from: deployer });
    await registry.methods.registerContract([], governorAddress).send({ from: deployer });
    await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer).send({ from: deployer });
  });
  await setup();
}
