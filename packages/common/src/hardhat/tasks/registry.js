const { task, types } = require("hardhat/config");
const { RegistryRolesEnum } = require("../../Enums");
const { waitForTxn } = require("./utils");

const _registerAccount = async (account, registry) => {
  const isRegistered = await registry.isContractRegistered(account);
  if (!isRegistered) {
    console.log(`Registering ${account}...`);
    const registerTxn = await waitForTxn(registry.registerContract([], account));
    console.log(`...Receipt: ${registerTxn.transactionHash}`);
  } else {
    console.log(`${account} is already registered!`);
  }
};

task("register-accounts", "Register deployer plus custom account with Registry capable of making price requests")
  .addOptionalParam("account", "Custom account to register", "", types.string)
  .setAction(async function(taskArguments, hre) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deployer } = await getNamedAccounts();
    const { account } = taskArguments;
    console.log(`Registering deployer @ ${deployer}`);

    const Registry = await deployments.get("Registry");
    const registry = await ethers.getContractAt("Registry", Registry.address, deployer);

    // Only those holding the ContractCreator role can register contracts. So we'll first add the deployer
    // as a ContractCreator so that it can register itself.
    const isCreator = await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, deployer);
    if (!isCreator) {
      console.log("Adding deployer as a Contract Creator...");
      const txn = await waitForTxn(registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer));
      console.log(`...Receipt: ${txn.transactionHash}`);
    }

    // Register custom account.
    if (account !== "") {
      await _registerAccount(account, registry, deployer);
    }

    // Register deployer by default.
    await _registerAccount(deployer, registry, deployer);
  });
