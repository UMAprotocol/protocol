const CentralizedOracle = artifacts.require("CentralizedOracle");
const Registry = artifacts.require("Registry");
const commandlineUtil = require("./CommandlineUtil");

async function getDeployAddress() {
  const accounts = await web3.eth.getAccounts();
  return accounts[0];
}

async function run() {
  // Usage: truffle exec scripts/RequestOraclePrice.js <Registry address> <CentralizedOracle address> <identifier> <time>
  // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
  if (process.argv.length < 8) {
    console.error("Not enough arguments. Must include <CentralizedOracle address>, <identifier>, and <time>");
    return;
  }

  const registryAddress = process.argv[4];
  if (!commandlineUtil.validateAddress(registryAddress)) {
    console.error("Registry's contract address missing. Exiting...");
    return;
  }

  const oracleAddress = process.argv[5];
  if (!commandlineUtil.validateAddress(oracleAddress)) {
    console.error("CentralizedOracle's contract address missing. Exiting...");
    return;
  }

  let deployAddress;
  try {
    deployAddress = await getDeployAddress();
  } catch (err) {
    console.error(err);
    return;
  }

  const registry = await Registry.at(registryAddress);
  try {
    await registry.addDerivativeCreator(deployAddress);
    console.log("Creator Added:", deployAddress);
    if (!(await registry.isDerivativeRegistered(deployAddress))) {
      await registry.registerDerivative([], deployAddress);
      console.log("Registered derivative:", deployAddress);
    }
  } catch (err) {
    console.log(err);
  }

  const identifier = process.argv[6];
  const identifierInBytes = web3.utils.fromAscii(identifier);
  const timeInSeconds = parseInt(process.argv[7], 10);
  const timeInBN = web3.utils.toBN(timeInSeconds);
  const time = new Date(timeInSeconds * 10e2);

  const oracle = await CentralizedOracle.at(oracleAddress);
  try {
    await oracle.addSupportedIdentifier(identifierInBytes);
    await oracle.requestPrice(identifierInBytes, timeInBN);
    console.log(`Price requested for identifier: ${identifier} at time: ${time}`);
  } catch (err) {
    console.log(err);
  }
}

module.exports = async function(callback) {
  await run();
  callback();
};
