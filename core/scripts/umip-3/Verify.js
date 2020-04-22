const assert = require("assert").strict;

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const VotingToken = artifacts.require("VotingToken");
const Umip3Upgrader = artifacts.require("Umip3Upgrader");

const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { interfaceName } = require("../../utils/Constants.js");

const truffleAssert = require("truffle-assertions");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const ownerRole = "0";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: "0x7492cdbc126ffc05c32249a470982173870e95b0",
  Registry: "0x46209e15a14f602897e6d72da858a6ad806403f1",
  Store: "0x74d367e2207e52f05963479e8395cf44909f075b",
  FinancialContractsAdmin: "0x3b99859be43d543960803c09a0247106e82e74ee",
  IdentifierWhitelist: "0x9e39424eab9161cc3399d886b1428cba71586cb8",
  Governor: "0x878cfedb234c226ddefd33657937af74c17628bf",
  Finder: "0x40f941E48A552bF496B154Af6bf55725f18D77c3" // Finder was no upgraded in UMIP3
};

async function runExport() {
  const finder = await Finder.deployed();
  const oldVoting = await Voting.deployed();
  console.log(oldVoting.address);

  console.log("Running UMIP-3 Upgrade Verifier🔥");

  /** ************************************
   * 1) Validating new contract bytecode *
   ***************************************/

  console.log(" 1. Validating deployed bytecode at new addresses...");

  // The deployed bytecode should match the expected bytecode for all new contracts deployed.
  await compiledByteCodeMatchesDeployed(Voting);
  await compiledByteCodeMatchesDeployed(Registry);
  await compiledByteCodeMatchesDeployed(Store);
  await compiledByteCodeMatchesDeployed(FinancialContractsAdmin);
  await compiledByteCodeMatchesDeployed(IdentifierWhitelist);
  await compiledByteCodeMatchesDeployed(Governor);

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

// Ensure that the contract specified has the latest contract code deployed at the `upgradeAddresses`
compiledByteCodeMatchesDeployed = async contract => {
  // `getCode` returns the bytecode of the actual contract deployed on chain
  const onChainByteCode = await web3.eth.getCode(upgradeAddresses[contract.contractName]);
  // `deployedBytecode` returns the bytecode that would be deployed had the truffle artifact been migrated on-chain.
  // This corresponds to the latest versions of the code and as such the assertion validates that the new
  // contract code has been deployed.
  const compiledByteCode = contract.toJSON().deployedBytecode;
  assert.equal(onChainByteCode, compiledByteCode);
};

// Ensure that the finder has the correct contract address for a given interface name
finderMatchesDeployment = async (contract, interfaceName) => {
  const finder = await Finder.deployed();
  const interfaceNameBytes32 = web3.utils.utf8ToHex(interfaceName);
  const finderImplementationAddress = await finder.getImplementationAddress(interfaceNameBytes32);
  const upgradeDeployedAddress = upgradeAddresses[contract.contractName];
  assert.equal(finderImplementationAddress.toLowerCase(), upgradeDeployedAddress.toLowerCase());
};

// Ensure that a given contract is owned by the NewGovernor
contractOwnedByNewGovernor = async contract => {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const currentOwner = await contractInstance.owner();
  assert.equal(currentOwner.toLowerCase(), upgradeAddresses.Governor.toLowerCase());
};

// Ensure that a given contract's multirole for `owner` is set to the new GovGovernor
newGovernorHasOwnerRole = async contract => {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const exclusiveRoleHolder = await contractInstance.getMember(ownerRole);
  assert.equal(exclusiveRoleHolder.toLowerCase(), upgradeAddresses.Governor.toLowerCase());
};

// Ensure that a given contract's multirole for `owner` is set to the foundation multisig wallet
contractOwnerRoleByFoundation = async contract => {
  const contractInstance = await contract.at(upgradeAddresses[contract.contractName]);
  const exclusiveRoleHolder = await contractInstance.getMember(ownerRole);
  assert.equal(exclusiveRoleHolder.toLowerCase(), foundationWallet.toLowerCase());
};

run = async function(callback) {
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
