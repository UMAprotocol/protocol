import { task } from "hardhat/config";
import { interfaceName } from "../../Constants";
import type { CombinedHRE } from "./types";

type InterfaceName = keyof typeof interfaceName;
function isInterfaceName(name: string | InterfaceName): name is InterfaceName {
  return name in interfaceName;
}

task("setup-finder", "Points Finder to DVM system contracts")
  .addFlag("registry", "Use if you want to set Registry")
  .addFlag("generichandler", "Use if you want to set GenericHandler")
  .addFlag("bridge", "Use if you want to set Bridge")
  .addFlag("identifierwhitelist", "Use if you want to set IdentifierWhitelist")
  .addFlag("addresswhitelist", "Use if you want to set AddressWhitelist")
  .addFlag("financialcontractsadmin", "Use if you want to set FinancialContractsAdmin")
  .addFlag("optimisticoracle", "Use if you want to set OptimisticOracle")
  .addFlag("store", "Use if you want to set Store")
  .addFlag("oraclespoke", "Use if you want to set OracleSpoke as the Oracle")
  .addFlag("mockoracle", "Use if you want to set MockOracle as the Oracle")
  .addFlag("sinkoracle", "Use if you want to set SinkOracle as the Oracle")
  .addFlag("prod", "Configure production setup in Finder")
  .addFlag("test", "Configure test setup in Finder")
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { padRight, utf8ToHex } = web3.utils;
    const { deployer } = await getNamedAccounts();
    const {
      registry,
      generichandler,
      bridge,
      identifierwhitelist,
      mockoracle,
      oraclespoke,
      addresswhitelist,
      financialcontractsadmin,
      store,
      optimisticoracle,
      sinkoracle,
      prod,
      test,
    } = taskArguments;

    // Determine based on task inputs which contracts to set in finder
    const contractsToSet = [];
    if (registry || prod || test) contractsToSet.push("Registry");
    if (generichandler || prod || test) contractsToSet.push("GenericHandler");
    if (bridge || prod || test) contractsToSet.push("Bridge");
    if (identifierwhitelist || prod || test) contractsToSet.push("IdentifierWhitelist");
    if (addresswhitelist || prod || test) contractsToSet.push("AddressWhitelist");
    if (financialcontractsadmin || prod || test) contractsToSet.push("FinancialContractsAdmin");
    if (optimisticoracle || prod || test) contractsToSet.push("OptimisticOracle");
    if (store || prod || test) contractsToSet.push("Store");

    // TEST ONLY:
    if (mockoracle || test) contractsToSet.push("MockOracleAncillary");

    // MUST BE SPECIFICALLY SET:
    // e.g. `yarn hardhat setup-finder --prod --sinkoracle`
    if (sinkoracle) contractsToSet.push("SinkOracle");
    if (oraclespoke) contractsToSet.push("OracleSpoke");

    // Synchronously send a transaction to add each contract to the Finder:
    const Finder = await deployments.get("Finder");
    const finder = new web3.eth.Contract(Finder.abi, Finder.address);
    console.log(`Using Finder @ ${finder.options.address}`);
    for (const contractName of contractsToSet) {
      const deployed = await deployments.get(contractName);
      const contract = new web3.eth.Contract(deployed.abi, deployed.address);
      if (!isInterfaceName(contractName)) throw new Error(`No mapped interface name for contract name ${contractName}`);
      const identifierHex = padRight(utf8ToHex(interfaceName[contractName]), 64);
      const currentlySetAddress = await finder.methods.interfacesImplemented(identifierHex).call();
      if (currentlySetAddress !== contract.options.address) {
        const txn = await finder.methods
          .changeImplementationAddress(identifierHex, contract.options.address)
          .send({ from: deployer });
        console.log(
          `Set ${contractName} in Finder to "${interfaceName[contractName]}" @ ${contract.options.address}, tx: ${txn.transactionHash}`
        );
      } else {
        console.log(
          `Already set ${contractName} in Finder to "${interfaceName[contractName]}" @ ${contract.options.address}`
        );
      }
    }
  });
