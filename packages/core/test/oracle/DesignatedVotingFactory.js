const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

const DesignatedVoting = getContract("DesignatedVoting");
const DesignatedVotingFactory = getContract("DesignatedVotingFactory");

describe("DesignatedVotingFactory", function () {
  let accounts;
  let owner;
  let voter;
  let voter2;
  let voter3;

  let factory;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, voter, voter2, voter3] = accounts;
    await runDefaultFixture(hre);
    factory = await DesignatedVotingFactory.deployed();
  });

  it("Deploy new", async function () {
    const designatedVotingAddress = await factory.methods.newDesignatedVoting(owner).call({ from: voter });
    await factory.methods.newDesignatedVoting(owner).send({ from: voter });

    assert.equal(
      designatedVotingAddress.toString(),
      (await factory.methods.designatedVotingContracts(voter).call()).toString()
    );
    const designatedVoting = await DesignatedVoting.at(designatedVotingAddress);
    const ownerRole = "0";
    assert(await designatedVoting.methods.holdsRole(ownerRole, owner).call());
    const voterRole = "1";
    assert(await designatedVoting.methods.holdsRole(voterRole, voter).call());

    // Reassign.
    await designatedVoting.methods.resetMember(voterRole, voter2).send({ from: owner });
    await factory.methods.setDesignatedVoting(ZERO_ADDRESS).send({ from: voter });
    await factory.methods.setDesignatedVoting(designatedVotingAddress).send({ from: voter2 });
    assert.equal(
      designatedVotingAddress.toString(),
      (await factory.methods.designatedVotingContracts(voter2).call()).toString()
    );
    assert.equal(ZERO_ADDRESS, (await factory.methods.designatedVotingContracts(voter).call()).toString());
  });

  it("Multiple Deployments", async function () {
    const designatedVoting1Address = await factory.methods.newDesignatedVoting(owner).call({ from: voter3 });
    await factory.methods.newDesignatedVoting(owner).send({ from: voter3 });

    assert.equal(designatedVoting1Address, (await factory.methods.designatedVotingContracts(voter3).call()).toString());

    const designatedVoting2Address = await factory.methods.newDesignatedVoting(owner).call({ from: voter3 });
    await factory.methods.newDesignatedVoting(owner).send({ from: voter3 });

    assert.equal(designatedVoting2Address, (await factory.methods.designatedVotingContracts(voter3).call()).toString());
  });
});
