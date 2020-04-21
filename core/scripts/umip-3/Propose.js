const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const VotingToken = artifacts.require("VotingToken");

const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { interfaceName } = require("../../utils/Constants.js");

const truffleAssert = require("truffle-assertions");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  console.log("Running UMIP-3 Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  // Get the previously deployed VotingToken and Finder.
  console.log("Keeping Existing VotingToken", VotingToken.address);
  console.log("Keeping Existing Finder", Finder.address);
  console.log("Sending Proposal to Existing Governor", Governor.address);

  const votingToken = await VotingToken.deployed();
  const finder = await Finder.deployed();
  const governor = await Governor.deployed();

  /** ***********************
   * 1) upgrade Voting.sol *
   *************************/

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Set phase length to one day.
  const secondsPerDay = "86400";

  const voting = await Voting.new(
    secondsPerDay,
    gatPercentage,
    inflationRate,
    rewardsExpirationTimeout,
    VotingToken.address,
    Finder.address,
    zeroAddress,
    { from: proposerWallet }
  );

  console.log("voting upgraded @", voting.address);

  const upgradeVotingTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), voting.address)
    .encodeABI();

  console.log("upgradeVotingTx", upgradeVotingTx);

  /** **************************
   * 2) upgrade Registry.sol *
   ***************************/

  const registry = await Registry.new({ from: proposerWallet });

  const upgradeRegistryTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry), registry.address)
    .encodeABI();

  console.log("upgradeRegistryTx", upgradeRegistryTx);

  /** ***********************
   * 3) upgrade Store.sol *
   ************************/

  const store = await Store.new(zeroAddress, { from: proposerWallet });

  const upgradeStoreTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Store), store.address)
    .encodeABI();

  console.log("upgradeStoreTx", upgradeStoreTx);

  /** *****************************************
   * 4) upgrade FinancialContractsAdmin.sol *
   ******************************************/

  const financialContractsAdmin = await FinancialContractsAdmin.new({
    from: proposerWallet
  });

  const upgradeFinancialContractsAdminTx = finder.contract.methods
    .changeImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin),
      financialContractsAdmin.address
    )
    .encodeABI();

  console.log("upgradeFinancialContractsAdminTx", upgradeFinancialContractsAdminTx);

  /** *****************************************
   * 5) upgrade IdentifierWhitelist.sol *
   ******************************************/

  const identifierWhitelist = await IdentifierWhitelist.new({
    from: proposerWallet
  });

  const upgradeIdentifierWhitelistTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address)
    .encodeABI();

  console.log("upgradeIdentifierWhitelistTx", upgradeIdentifierWhitelistTx);

  /** *****************************************
   * 6) deploy Governor.sol *
   ******************************************/

  const newGovernor = await Governor.new(finder.address, zeroAddress, { from: proposerWallet });

  /** ********************************************
   * 7) update permissions on all new contracts *
   **********************************************/

  console.log("Updating new contracts' permissions.");

  // Add governor as a special registered contract so it can send proposals to the Voting contract.
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, proposerWallet, { from: proposerWallet });
  await registry.registerContract([], newGovernor.address, { from: proposerWallet });
  await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, proposerWallet, { from: proposerWallet });

  // The owner role is generally the 0th role (this is true for all the contracts in this script).
  const ownerRole = "0";

  // Governor is owned by the owner of the previous governor and the proposerWallet should remain the proposer.
  const multisig = await governor.getMember(ownerRole);
  await newGovernor.resetMember(ownerRole, multisig, { from: proposerWallet });

  // Registry should be owned by the governor.
  await registry.resetMember(ownerRole, newGovernor.address, { from: proposerWallet });

  // FinancialContractsAdmin should be owned by the governor.
  await financialContractsAdmin.transferOwnership(newGovernor.address, { from: proposerWallet });

  // Store should be owned by the governor and the hot wallet/deployer should remain the withdrawer.
  await store.resetMember(ownerRole, newGovernor.address, { from: proposerWallet });

  // Identifier Whitelist should be owned by governor
  await identifierWhitelist.transferOwnership(newGovernor.address, { from: proposerWallet });

  // Voting should be owned by governor
  await voting.transferOwnership(newGovernor.address, { from: proposerWallet });

  /** *********************************************
   * 8) update permissions on existing contracts *
   ***********************************************/

  console.log("Preparing proposal transactions related to permissioning on existing contracts.");

  // Add Voting contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingAsTokenMinterTx = votingToken.contract.methods.addMember(minter, voting.address).encodeABI();

  console.log("addVotingAsTokenMinterTx", addVotingAsTokenMinterTx);

  // New Governor should own the token.
  const changeVotingTokenOwnerTx = votingToken.contract.methods.resetMember(ownerRole, newGovernor.address).encodeABI();

  console.log("changeVotingTokenOwnerTx", changeVotingTokenOwnerTx);

  // Finder should be owned by the new governor. Note: this transaction should be one of the last so the old governor
  // doesn't lose its upgrade permissions before finishing other updates.
  const changeFinderOwnerTx = finder.contract.methods.transferOwnership(newGovernor.address).encodeABI();

  console.log("changeFinderOwnerTx", changeFinderOwnerTx);

  /** *********************************
   * 9) Propose upgrades to governor *
   ***********************************/

  await governor.propose(
    [
      {
        to: finder.address,
        value: 0,
        data: upgradeVotingTx
      },
      {
        to: finder.address,
        value: 0,
        data: upgradeRegistryTx
      },
      {
        to: finder.address,
        value: 0,
        data: upgradeStoreTx
      },
      {
        to: finder.address,
        value: 0,
        data: upgradeFinancialContractsAdminTx
      },
      {
        to: finder.address,
        value: 0,
        data: upgradeIdentifierWhitelistTx
      },
      {
        to: finder.address,
        value: 0,
        data: addVotingAsTokenMinterTx
      },
      {
        to: finder.address,
        value: 0,
        data: changeVotingTokenOwnerTx
      },
      {
        to: finder.address,
        value: 0,
        data: changeFinderOwnerTx
      }
    ],
    { from: proposerWallet }
  );

  console.log(`

Newly Proposed DVM Addresses

Voting:                  ${voting.address}
Registry:                ${registry.address}
Store:                   ${store.address}
FinancialContractsAdmin: ${financialContractsAdmin.address}
IdentifierWhitelist:     ${identifierWhitelist.address}
Governor:                ${newGovernor.address}
`);
}

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
