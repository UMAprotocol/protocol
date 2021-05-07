const { task } = require("hardhat/config");
const { waitForTxn } = require("./utils");
const { stringToBytes32, interfaceName } = require("@uma/common");

task("setup-finder", "Points Finder to DVM system contracts")
  .addFlag("registry", "Use if you want to set Registry")
  .addFlag("generichandler", "Use if you want to set GenericHandler")
  .addFlag("bridge", "Use if you want to set Bridge")
  .addFlag("identifierwhitelist", "Use if you want to set IdentifierWhitelist")
  .addFlag("mockoracle", "Use if you want to set MockOracle as the Oracle")
  .setAction(async function(taskArguments, hre) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { registry, generichandler, bridge, identifierwhitelist, mockoracle } = taskArguments;

    // Determine based on task inputs which contracts to set in finder
    const contractsToSet = [];
    if (registry) contractsToSet.push("Registry");
    if (generichandler) contractsToSet.push("GenericHandler");
    if (bridge) contractsToSet.push("Bridge");
    if (identifierwhitelist) contractsToSet.push("IdentifierWhitelist");
    if (mockoracle) contractsToSet.push("MockOracleAncillary");

    // Synchronously send a transaction to add each contract to the Finder:
    const Finder = await deployments.get("Finder");
    const finder = await ethers.getContractAt("Finder", Finder.address);
    console.log(`Using Finder @ ${finder.address}`);
    for (let contractName of contractsToSet) {
      const deployed = await deployments.get(contractName);
      const contract = await ethers.getContractAt(contractName, deployed.address);
      const currentlySetAddress = await finder.interfacesImplemented(stringToBytes32(interfaceName[contractName]));
      if (currentlySetAddress !== contract.address) {
        const txn = await waitForTxn(
          finder.changeImplementationAddress(stringToBytes32(interfaceName[contractName]), contract.address, {
            from: deployer
          })
        );
        console.log(
          `Set ${contractName} in Finder to deployed instance @ ${contract.address}, tx: ${txn.transactionHash}`
        );
      } else {
        console.log(`Already set ${contractName} in Finder to deployed instance @ ${contract.address}`);
      }
    }
  });
