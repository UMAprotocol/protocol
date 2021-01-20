// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/identifier-umip/1_Propose.js --network mainnet-fork --identifier USDETH --identifier ETHBTC from core

// Use the same ABI's as deployed contracts:
const { getTruffleContract } = require("../../index");
const Governor = getTruffleContract("Governor", web3, "1.1.0");
const Finder = getTruffleContract("Finder", web3, "1.1.0");
const Registry = getTruffleContract("Registry", web3, "1.1.0");
const OptimisticOracle = getTruffleContract("OptimisticOracle", web3);

const { RegistryRolesEnum, ZERO_ADDRESS, interfaceName } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["deployedAddress"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  const finder = await Finder.deployed();
  const governor = await Governor.deployed();

  let optimisticOracle;
  if (!argv.deployedAddress) {
    const account = (await web3.eth.getAccounts())[0];
    console.log("--deployedAddress not provided. Deploying OptimisticOracle...");
    optimisticOracle = await OptimisticOracle.new("7200", finder.address, ZERO_ADDRESS, { from: account });
    console.log("OptimisticOracle Deployed at", optimisticOracle.address);
  } else {
    console.log("Using provided OptimisticOracle at", argv.deployedAddress);
    optimisticOracle = await OptimisticOracle.at(argv.deployedAddress);
  }

  // The proposal will add this new contract creator to the Registry.
  const registry = await Registry.deployed();

  // 1. Temporarily add the Governor as a contract creator.
  const addGovernorToRegistryTx = registry.contract.methods
    .addMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.address)
    .encodeABI();

  console.log("addGovernorToRegistryTx", addGovernorToRegistryTx);

  // 2. Register the OptimisticOracle as a verified contract.
  const registerOptimisticOracleTx = registry.contract.methods
    .registerContract([], optimisticOracle.address)
    .encodeABI();

  console.log("registerOptimisticOracleTx", registerOptimisticOracleTx);

  // 3. Remove the Governor from being a contract creator.
  const removeGovernorFromRegistryTx = registry.contract.methods
    .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.address)
    .encodeABI();

  console.log("removeGovernorFromRegistryTx", removeGovernorFromRegistryTx);

  // 4. Add the OptimisticOracle to the Finder.
  const addOptimisticOracleToFinderTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address)
    .encodeABI();

  console.log("addOptimisticOracleToFinderTx", addOptimisticOracleToFinderTx);

  console.log("Proposing...");

  // Send the proposal
  await governor.propose(
    [
      {
        to: registry.address,
        value: 0,
        data: addGovernorToRegistryTx
      },
      {
        to: registry.address,
        value: 0,
        data: registerOptimisticOracleTx
      },
      {
        to: registry.address,
        value: 0,
        data: removeGovernorFromRegistryTx
      },
      {
        to: finder.address,
        value: 0,
        data: addOptimisticOracleToFinderTx
      }
    ],
    { from: proposerWallet, gas: 2000000 }
  );

  console.log("Proposal Done.");
}

const run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
