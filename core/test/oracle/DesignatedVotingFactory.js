const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");

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

  it("Deploy new contract and then assign to new voter", async function() {
    const designatedVotingAddress = await factory.newDesignatedVoting.call(owner, { from: voter });
    const newDesignatedVotingResult = await factory.newDesignatedVoting(owner, { from: voter });
    assert(await didContractThrow(factory.newDesignatedVoting(owner, { from: voter })));

    // Check event was emitted.
    truffleAssert.eventEmitted(newDesignatedVotingResult, "ChangedDesignatedVotingMapping", ev => {
      return ev.voterAddress == voter && ev.contractAddress == designatedVotingAddress;
    });

    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter)).toString());
    const designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.holdsRole(ownerRole, owner));
    const voterRole = "1";
    assert(await designatedVoting.holdsRole(voterRole, voter));

    // Reassign.
    await designatedVoting.resetMember(voterRole, voter2, { from: owner });
    assert(await didContractThrow(factory.setDesignatedVoting(designatedVotingAddress, { from: voter })));
    const setDesignatedVotingResult = await factory.setDesignatedVoting(designatedVotingAddress, { from: voter2 });
    assert.equal(designatedVotingAddress.toString(), (await factory.designatedVotingContracts(voter2)).toString());

    // Check event was emitted.
    truffleAssert.eventEmitted(setDesignatedVotingResult, "ChangedDesignatedVotingMapping", ev => {
      return ev.voterAddress == voter2 && ev.contractAddress == designatedVotingAddress;
    });
  });
});
