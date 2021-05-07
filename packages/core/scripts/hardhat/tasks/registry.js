const { task } = require("hardhat/config");
const { RegistryRolesEnum } = require("@uma/common");
const { waitForTxn } = require('./utils')

task("register-deployer", "Register deployer with Registry capable of making price requests")
  .setAction(async function(taskArguments, hre) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deployer } = await getNamedAccounts();
    console.log(`Registering deployer @ ${deployer}`);

    const Registry = await deployments.get("Registry");
    const registry = await ethers.getContractAt("Registry", Registry.address);

    // Only those holding the ContractCreator role can register contracts. So we'll first add the deployer
    // as a ContractCreator so that it can register itself.
    const isCreator = await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, deployer);
    if (!isCreator) {
        console.log(`Adding deployer as a Contract Creator...`);
        const txn = await waitForTxn(registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer));
        console.log(`...Receipt: ${txn.transactionHash}`)
    }

    const isRegistered = await registry.isContractRegistered(deployer);
    if (!isRegistered) {
        console.log(`Registering deployer...`);
        const registerTxn = await waitForTxn(registry.registerContract([], deployer, { from: deployer }));
        console.log(`...Receipt: ${registerTxn.transactionHash}`)
    } else {
        console.log(`Deployer is already registered!`);
    }
  });
