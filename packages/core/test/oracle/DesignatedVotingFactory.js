const { ZERO_ADDRESS } = require("@uma/common");

const DesignatedVoting = artifacts.require("DesignatedVoting");
const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");

contract("DesignatedVotingFactory", function(accounts) {
  const owner = accounts[1];
  const voter = accounts[2];
  const voter2 = accounts[3];
  const voter3 = accounts[4];

  let factory;

  before(async function() {
    factory = await DesignatedVotingFactory.deployed();
  });

  it("Deploy new", async function() {
    const designatedVotingAddress = await factory.newDesignatedVoting.call(owner, { from: voter });
    await factory.newDesignatedVoting(owner, { from: voter });

    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter)).toString());
    const designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.holdsRole(ownerRole, owner));
    const voterRole = "1";
    assert(await designatedVoting.holdsRole(voterRole, voter));

    // Reassign.
    await designatedVoting.resetMember(voterRole, voter2, { from: owner });
    await factory.setDesignatedVoting(ZERO_ADDRESS, { from: voter });
    await factory.setDesignatedVoting(designatedVotingAddress, { from: voter2 });
    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter2)).toString());
    assert.equal(ZERO_ADDRESS, (await factory.designatedVotingContracts(voter)).toString());
  });

  it("Multiple Deployments", async function() {
    const designatedVoting1Address = await factory.newDesignatedVoting.call(owner, { from: voter3 });
    await factory.newDesignatedVoting(owner, { from: voter3 });

    assert.equal(designatedVoting1Address, (await factory.designatedVotingContracts(voter3)).toString());

    const designatedVoting2Address = await factory.newDesignatedVoting.call(owner, { from: voter3 });
    await factory.newDesignatedVoting(owner, { from: voter3 });

    assert.equal(designatedVoting2Address, (await factory.designatedVotingContracts(voter3)).toString());
  });
});
