const deployFinder = require("../migrations/2_deploy_finder.js");
const deployTimer = require("../migrations/3_deploy_timer.js");
const deployVotingToken = require("../migrations/4_deploy_voting_token.js");
const deployVoting = require("../migrations/5_deploy_voting.js");
const deployRegistry = require("../migrations/6_deploy_registry.js");
const deployFinancialContractsAdmin = require("../migrations/7_deploy_financial_contracts_admin.js");
const deployStore = require("../migrations/8_deploy_store.js");
const deployGovernor = require("../migrations/9_deploy_governor.js");
const deployDesignatedVotingFactory = require("../migrations/10_deploy_designated_voting_factory.js");
const deploySupportIdentifiers = require("../migrations/11_support_identifiers.js");
const deployTestnetToken = require("../migrations/12_deploy_testnet_token.js");
const deployTokenfactory = require("../migrations/13_deploy_tokenfactory.js");
const deployExpiringMultiPartyCreator = require("../migrations/14_deploy_expiring_multi_party_creator.js");
const deployLocalWeth = require("../migrations/15_deploy_local_weth.js");

const { getKeysForNetwork } = require("../../common/MigrationUtils.js");

module.exports = async ({ network, web3 }) => {
  const accounts = await web3.eth.getAccounts();
  const { deployer } = getKeysForNetwork(network, accounts);

  await deployFinder(deployer, network.name, accounts);
  await deployTimer(deployer, network.name, accounts);
  await deployVotingToken(deployer, network.name, accounts);
  await deployVoting(deployer, network.name, accounts);
  await deployRegistry(deployer, network.name, accounts);
  await deployFinancialContractsAdmin(deployer, network.name, accounts);
  await deployStore(deployer, network.name, accounts);
  await deployGovernor(deployer, network.name, accounts);
  await deployDesignatedVotingFactory(deployer, network.name, accounts);
  await deploySupportIdentifiers(deployer, network.name, accounts);
  await deployTestnetToken(deployer, network.name, accounts);
  await deployTokenfactory(deployer, network.name, accounts);
  await deployExpiringMultiPartyCreator(deployer, network.name, accounts);
  await deployLocalWeth(deployer, network.name, accounts);
};
