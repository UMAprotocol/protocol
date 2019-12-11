const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const DesignatedVoting = artifacts.require("DesignatedVoting");
const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");
const Finder = artifacts.require("Finder");

contract("DesignatedVotingFactory", function(accounts) {
  const owner = accounts[1];
  const voter = accounts[2];

  let factory;

  before(async function() {
    factory = await DesignatedVotingFactory.deployed();
  });

  it("Deploy new", async function() {
    const designatedVotingAddress = await factory.newDesignatedVoting.call(owner, { from: voter });
    await factory.newDesignatedVoting(owner, { from: voter });
    assert(await didContractThrow(factory.newDesignatedVoting(owner, { from: voter })));

    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter)).toString());
    designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.holdsRole(ownerRole, owner));
    const voterRole = "1";
    assert(await designatedVoting.holdsRole(voterRole, voter));
  });
});
