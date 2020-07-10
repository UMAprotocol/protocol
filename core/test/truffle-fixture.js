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

module.exports = async ({ network, web3 }) => {
  const accounts = await web3.eth.getAccounts();

  await deployFinder(null, network.name, accounts);
  await deployTimer(null, network.name, accounts);
  await deployVotingToken(null, network.name, accounts);
  await deployVoting(null, network.name, accounts);
  await deployRegistry(null, network.name, accounts);
  await deployFinancialContractsAdmin(null, network.name, accounts);
  await deployStore(null, network.name, accounts);
  await deployGovernor(null, network.name, accounts);
  await deployDesignatedVotingFactory(null, network.name, accounts);
  await deploySupportIdentifiers(null, network.name, accounts);
  await deployTestnetToken(null, network.name, accounts);
  await deployTokenfactory(null, network.name, accounts);
  await deployExpiringMultiPartyCreator(null, network.name, accounts);
  await deployLocalWeth(null, network.name, accounts);
};
