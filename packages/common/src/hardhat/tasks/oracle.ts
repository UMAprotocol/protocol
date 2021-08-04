import { task, types } from "hardhat/config";
import { CombinedHRE } from "./types";

task("check-price", "Check whether price has resolved for Oracle and return price")
  .addParam("oracle", "OracleInterface implementation address to check", undefined, types.string)
  .addParam("identifier", "Request identifier", undefined, types.string)
  .addParam("timestamp", "Request timestamp", undefined, types.string)
  .addParam("ancillary", "Request ancillary data", undefined, types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { oracle, identifier, timestamp, ancillary } = taskArguments;

    const Registry = await deployments.get("Registry");
    const registry = new web3.eth.Contract(Registry.abi, Registry.address);
    console.log(`Checking Registry @ ${registry.options.address}`);

    const isRegistered = (await registry.methods.isContractRegistered(deployer).call()) as boolean;
    if (!isRegistered) {
      console.log("Caller not registered");
    } else {
      const Oracle = await deployments.get("OracleAncillaryInterface");
      const oracleContract = new web3.eth.Contract(Oracle.abi, oracle);
      const hasPrice = (await oracleContract.methods
        .hasPrice(identifier, timestamp, ancillary)
        .call({ from: deployer })) as boolean;
      console.log(`Oracle @ ${oracle} ${hasPrice ? "has" : "does not have"} a price`);
      if (hasPrice) {
        const price = await oracleContract.methods.getPrice(identifier, timestamp, ancillary).call({ from: deployer });
        console.log(`Price: ${price.toString()}`);
      }
    }
  });
