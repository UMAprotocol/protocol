const { task, types } = require("hardhat/config");
const { RegistryRolesEnum } = require("../../Enums");

const _registerAccount = async (account, registry, deployer) => {
  const isRegistered = await registry.methods.isContractRegistered(account).call();
  if (!isRegistered) {
    console.log(`Registering ${account}...`);
    const registerTxn = await registry.methods.registerContract([], account).send({ from: deployer });
    console.log(`...Receipt: ${registerTxn.transactionHash}`);
  } else {
    console.log(`${account} is already registered!`);
  }
};

task("register-accounts", "Register deployer plus custom account with Registry capable of making price requests")
  .addOptionalParam("account", "Custom account to register", "", types.string)
  .setAction(async function (taskArguments, hre) {
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { account } = taskArguments;
    console.log(`Registering deployer @ ${deployer}`);

    const Registry = await deployments.get("Registry");
    const registry = new web3.eth.Contract(Registry.abi, Registry.address);

    // Only those holding the ContractCreator role can register contracts. So we'll first add the deployer
    // as a ContractCreator so that it can register itself.
    const isCreator = await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, deployer).call();
    if (!isCreator) {
      console.log("Adding deployer as a Contract Creator...");
      const txn = await registry.methods
        .addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer)
        .send({ from: deployer });
      console.log(`...Receipt: ${txn.transactionHash}`);
    }

    // Register custom account.
    if (account !== "") {
      await _registerAccount(account, registry, deployer);
    }

    // Register deployer by default.
    await _registerAccount(deployer, registry, deployer);
  });
