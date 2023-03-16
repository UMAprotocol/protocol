const hre = require("hardhat");
const { runVotingV2Fixture } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");

const DesignatedVoting = getContract("DesignatedVotingV2");
const DesignatedVotingV2Factory = getContract("DesignatedVotingV2Factory");
const Finder = getContract("Finder");

describe("DesignatedVotingV2Factory", function () {
  let accounts, owner, voter, factory;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, voter] = accounts;
    await runVotingV2Fixture(hre);
    factory = await DesignatedVotingV2Factory.new((await Finder.deployed()).options.address).send({ from: owner });
  });

  it("Deploy new", async function () {
    const designatedVotingAddress = await factory.methods.newDesignatedVoting(owner, voter).call({ from: voter });
    await factory.methods.newDesignatedVoting(owner, voter).send({ from: voter });

    let events = await factory.getPastEvents("NewDesignatedVoting", {
      fromBlock: 0,
      filter: { designatedVoter: voter },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].returnValues.voter, voter);
    assert.equal(events[0].returnValues.designatedVoting, designatedVotingAddress);
    assert.equal(events[0].returnValues.owner, owner);

    const designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.methods.holdsRole(ownerRole, owner).call());
    const voterRole = "1";
    assert(await designatedVoting.methods.holdsRole(voterRole, voter).call());
  });
});
