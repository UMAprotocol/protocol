import { task, types } from "hardhat/config";
import { RegistryRolesEnum } from "../../Enums";
import { Contract } from "web3-eth-contract";
import { CombinedHRE } from "./types";

const _registerAccount = async (account: string, registry: Contract, deployer: string) => {
  const isRegistered = await registry.methods.isContractRegistered(account).call();
  if (!isRegistered) {
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

    console.log(`Registering ${account}...`);
    const registerTxn = await registry.methods.registerContract([], account).send({ from: deployer });
    console.log(`...Receipt: ${registerTxn.transactionHash}`);

    // Remove deployer from contract creator role.
    console.log("Removing deployer as Contract Creator...");
    const txn = await registry.methods
      .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, deployer)
      .send({ from: deployer });
    console.log(`...Receipt: ${txn.transactionHash}`);
  } else {
    console.log(`${account} is already registered!`);
  }
};

task("register-accounts", "Register custom account with Registry capable of making price requests")
  .addOptionalParam("account", "Custom account to register", "", types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { account } = taskArguments;

    const Registry = await deployments.get("Registry");
    const registry = new web3.eth.Contract(Registry.abi, Registry.address);
    console.log(`Using Registry @ ${registry.options.address}`);

    if (account !== "") {
      await _registerAccount(account, registry, deployer);
    }
  });
