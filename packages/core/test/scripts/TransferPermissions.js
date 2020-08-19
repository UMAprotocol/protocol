const TransferPermissions = require("../../scripts/TransferPermissions.js");
const assertPackage = require("assert");

const Finder = artifacts.require("Finder");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Governor = artifacts.require("Governor");

contract("scripts/TransferPermissions.js", function(accounts) {
  it("TestRun", async function() {
    const multisig = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    await TransferPermissions.transferPermissions(multisig);

    // Multisig should be the owner and the hot wallet should be the proposer.
    const governor = await Governor.deployed();
    assert.equal(await governor.getMember("0"), multisig);
    assert.equal(await governor.getMember("1"), accounts[0]);

    // Governor should be the owner.
    const finder = await Finder.deployed();
    assert.equal(await finder.owner(), governor.address);

    // Governor should be the owner.
    const financialContractsAdmin = await FinancialContractsAdmin.deployed();
    assert.equal(await financialContractsAdmin.owner(), governor.address);

    // Governor should be the owner and hot wallet should be the withdrawer.
    const store = await Store.deployed();
    assert.equal(await store.getMember("0"), governor.address);
    assert.equal(await store.getMember("1"), accounts[0]);

    // Governor should be the owner.
    const supportedIdentifiers = await IdentifierWhitelist.deployed();
    assert.equal(await supportedIdentifiers.owner(), governor.address);

    // Governor should be the owner, the hot wallet should NOT be able to mint or burn, and the Voting contract should
    // be able to mint.
    const votingToken = await VotingToken.deployed();
    const voting = await Voting.deployed();
    assert.equal(await votingToken.getMember("0"), governor.address);
    assert.isFalse(await votingToken.holdsRole("1", accounts[0]));
    assert.isFalse(await votingToken.holdsRole("2", accounts[0]));
    assert.isTrue(await votingToken.holdsRole("1", voting.address));
  });
});
