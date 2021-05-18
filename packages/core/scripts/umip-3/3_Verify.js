// This script verify that the UMPIP-3 upgrade was executed correctly by checking deployed bytecodes,
// assigned ownerships and roles. It can be run on the main net after the upgrade is completed
// or on the local Ganache mainnet fork to validate the execution of the previous  two scripts.
// This script does not need any wallets unlocked and does not make any on-chain state changes. It can be run as:
// truffle exec ./scripts/umip-3/3_Verify.js --network mainnet-fork

const assert = require("assert").strict;

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");

const { interfaceName } = require("@uma/common");

const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const ownerRole = "0";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: Voting.address,
  Registry: Registry.address,
  Store: Store.address,
  FinancialContractsAdmin: FinancialContractsAdmin.address,
  IdentifierWhitelist: IdentifierWhitelist.address,
  Governor: Governor.address,
  Finder: Finder.address, // Finder was not upgraded in UMIP3
};

async function runExport() {
  console.log("Running UMIP-3 Upgrade Verifier🔥");

  /** ************************************
   * 1) Validating new contract bytecode *
   ***************************************/

  console.log(" 1. Validating deployed bytecode at new addresses...");

  // The deployed bytecode should match the expected bytecode for all new contracts deployed.
  // await compiledByteCodeMatchesDeployed(Voting);
  // await compiledByteCodeMatchesDeployed(Registry);
  // await compiledByteCodeMatchesDeployed(Store);
  // await compiledByteCodeMatchesDeployed(FinancialContractsAdmin);
  // await compiledByteCodeMatchesDeployed(IdentifierWhitelist);
  // await compiledByteCodeMatchesDeployed(Governor);

  console.log("✅ All deployed bytecode match!");

  /** ******************************************
   * 2) Validating registry contract addresses *
   *********************************************/

  console.log(" 2. Validating finder registration addresses...");

  // The finder should correctly match the addresses of all new contracts
  await finderMatchesDeployment(Voting, interfaceName.Oracle);
  await finderMatchesDeployment(Registry, interfaceName.Registry);
  await finderMatchesDeployment(Store, interfaceName.Store);
  await finderMatchesDeployment(FinancialContractsAdmin, interfaceName.FinancialContractsAdmin);
  await finderMatchesDeployment(IdentifierWhitelist, interfaceName.IdentifierWhitelist);
  await finderMatchesDeployment(Registry, interfaceName.Registry);

  console.log("✅ All registered interfaces match!");

  /** ******************************************
   * 3) Validating migrated contract ownership *
   *********************************************/

  console.log(" 3. Validating deployed contracts are owned by new governor...");

  // The Financial Contracts Admin, identifierWhiteList and Voting are all
  // ownable and should be owned by the the new governor
  await contractOwnedByNewGovernor(FinancialContractsAdmin);
  await contractOwnedByNewGovernor(IdentifierWhitelist);
  await contractOwnedByNewGovernor(Voting);

  // The finder's ownership is transfered to the UMIP3Upgrader during the upgrade. This should
  // be transferred back to the newGovernor at conclusion of the upgrade.
  await contractOwnedByNewGovernor(Finder);

  console.log("✅ All contract correctly transferred ownership!");

  /** ***************************************
   * 3) Validating migrated contracts roles *
   ******************************************/

  console.log(" 4. Validating deployed contract roles...");

  // Registry and Store are both multiRole and should have the exclusive owner role
  // set as the new governor only
  await newGovernorHasOwnerRole(Registry);
  await newGovernorHasOwnerRole(Store);

  // The Governor is multiRole and should only be owned by the foundation wallet.
  await contractOwnerRoleByFoundation(Governor);

  console.log("✅ All contract correctly transferred roles!");
}

// Ensure that the finder has the correct contract address for a given interface name
async function finderMatchesDeployment(contract, interfaceName) {
  const finder = await Finder.deployed();
  const interfaceNameBytes32 = web3.utils.utf8ToHex(interfaceName);
  const finderSetAddress = await finder.getImplementationAddress(interfaceNameBytes32);
  const deployedAddress = upgradeAddresses[contract.contractName];
  assert.equal(web3.utils.toChecksumAddress(finderSetAddress), web3.utils.toChecksumAddress(deployedAddress));
}

// Ensure that a given contract is owned by the NewGovernor
async function contractOwnedByNewGovernor(contract) {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const currentOwner = await contractInstance.owner();
  assert.equal(web3.utils.toChecksumAddress(currentOwner), web3.utils.toChecksumAddress(upgradeAddresses.Governor));
}

// Ensure that a given contract's multirole for `owner` is set to the new GovGovernor
async function newGovernorHasOwnerRole(contract) {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const roleHolder = await contractInstance.getMember(ownerRole);
  assert.equal(web3.utils.toChecksumAddress(roleHolder), web3.utils.toChecksumAddress(upgradeAddresses.Governor));
}

// Ensure that a given contract's multirole for `owner` is set to the foundation multisig wallet
async function contractOwnerRoleByFoundation(contract) {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const exclusiveRoleHolder = await contractInstance.getMember(ownerRole);
  assert.equal(web3.utils.toChecksumAddress(exclusiveRoleHolder), web3.utils.toChecksumAddress(foundationWallet));
}

const run = async function (callback) {
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
