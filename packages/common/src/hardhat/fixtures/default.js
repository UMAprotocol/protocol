const { interfaceName } = require("../../Constants");
const { RegistryRolesEnum } = require("../../Enums");

async function runDefaultFixture({ deployments }) {
  const setup = deployments.createFixture(async ({ deployments, getNamedAccounts, web3 }) => {
    const { padRight, toWei, utf8ToHex } = web3.utils;
    await deployments.fixture();
    const { deployer } = await getNamedAccounts();

    const getDeployment = async (name) => {
      const contract = await deployments.get(name);
      return new web3.eth.Contract(contract.abi, contract.address);
    };

    // Setup finder.
    const finder = await getDeployment("Finder");

    const addToFinder = async (deploymentName, finderName) => {
      const { address } = await deployments.get(deploymentName);
      const hexName = padRight(utf8ToHex(finderName));
      await finder.methods.changeImplementationAddress(hexName, address).send({ from: deployer });
    };

    await addToFinder("FinancialContractsAdmin", interfaceName.FinancialContractsAdmin);
    await addToFinder("Voting", interfaceName.Oracle);
    await addToFinder("Registry", interfaceName.Registry);
    await addToFinder("Store", interfaceName.Store);
    await addToFinder("IdentifierWhitelist", interfaceName.IdentifierWhitelist);
    await addToFinder("AddressWhitelist", interfaceName.CollateralWhitelist);
    await addToFinder("OptimisticOracle", interfaceName.OptimisticOracle);
    await addToFinder("Bridge", interfaceName.Bridge);
    await addToFinder("GenericHandler", interfaceName.GenericHandler);

    // Setup token.
    const votingToken = await getDeployment("VotingToken");
    const minterRoleEnumValue = 1;
    await votingToken.methods.addMember(minterRoleEnumValue, deployer).send({ from: deployer });
    await votingToken.methods.mint(deployer, toWei("100000000")).send({ from: deployer });
    await votingToken.methods.removeMember(minterRoleEnumValue, deployer).send({ from: deployer });

    // Set the minter to be the Voting contract.
    const { address: votingAddress } = await deployments.get("Voting");
    await votingToken.methods.addMember(minterRoleEnumValue, votingAddress).send({ from: deployer });

    // Setup Registry.
    const registry = await getDeployment("Registry");

    // Add creators.
    const { address: empCreatorAddress } = await deployments.get("ExpiringMultiPartyCreator");
    const { address: perpCreatorAddress } = await deployments.get("PerpetualCreator");
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, empCreatorAddress).send({ from: deployer });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpCreatorAddress).send({ from: deployer });

    // Add pre-registered contracts.
    const { address: governorAddress } = await deployments.get("Governor");
    const { address: optimisticOracleAddress } = await deployments.get("OptimisticOracle");
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer).send({ from: deployer });
    await registry.methods.registerContract([], governorAddress).send({ from: deployer });
    await registry.methods.registerContract([], optimisticOracleAddress).send({ from: deployer });
    await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer).send({ from: deployer });
  });
  await setup();
}

module.exports = { runDefaultFixture };
