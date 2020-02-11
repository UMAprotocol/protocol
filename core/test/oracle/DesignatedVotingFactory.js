const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const DesignatedVoting = artifacts.require("DesignatedVoting");
const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");
const Finder = artifacts.require("Finder");

contract("DesignatedVotingFactory", function(accounts) {
  const owner = accounts[1];
  const voter = accounts[2];
  const voter2 = accounts[3];

  let factory;

  before(async function() {
    factory = await DesignatedVotingFactory.deployed();
  });

  it("Deploy new", async function() {
    const designatedVotingAddress = await factory.newDesignatedVoting.call(owner, { from: voter });
    await factory.newDesignatedVoting(owner, { from: voter });
    assert(await didContractThrow(factory.newDesignatedVoting(owner, { from: voter })));

    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter)).toString());
    const designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.holdsRole(ownerRole, owner));
    const voterRole = "1";
    assert(await designatedVoting.holdsRole(voterRole, voter));

    // Reassign.
    await designatedVoting.resetMember(voterRole, voter2, { from: owner });
    assert(await didContractThrow(factory.setDesignatedVoting(designatedVotingAddress, { from: voter })));
    await factory.setDesignatedVoting(designatedVotingAddress, { from: voter2 });
    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter2)).toString());
  });
});
