const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const MultiRoleTest = getContract("MultiRoleTest");

describe("MultiRole", function () {
  let accounts;
  let account1;
  let account2;
  let account3;
  let account4;
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4] = accounts;
  });

  it("Exclusive Self-managed role", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] });

    // Shared methods should fail.
    assert(await didContractThrow(multiRole.methods.addMember("1", account2).send({ from: account1 })));
    assert(await didContractThrow(multiRole.methods.removeMember("1", account1).send({ from: account1 })));

    // Create methods should fail.
    assert(
      await didContractThrow(multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(multiRole.methods.createSharedRole("1", "1", [account1]).send({ from: accounts[0] }))
    );

    // Cannot call methods on roles that haven't been created.
    assert(await didContractThrow(multiRole.methods.addMember("2", account2).send({ from: account1 })));
    assert(await didContractThrow(multiRole.methods.removeMember("2", account2).send({ from: account1 })));
    assert(await didContractThrow(multiRole.methods.resetMember("2", account2).send({ from: account1 })));
    assert(await didContractThrow(multiRole.methods.getMember("2").send({ from: accounts[0] })));
    assert(await didContractThrow(multiRole.methods.holdsRole("2", account2).send({ from: accounts[0] })));

    // Check that only the account1 is the holder of the role.
    assert.isTrue(await multiRole.methods.holdsRole("1", account1).call());
    assert.isFalse(await multiRole.methods.holdsRole("1", account2).call());
    assert.equal(await multiRole.methods.getMember("1").call(), account1);
    await multiRole.methods.revertIfNotHoldingRole("1").send({ from: account1 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("1").send({ from: account2 })));

    // Cannot set an exclusive role to the 0x0 address
    assert(await didContractThrow(multiRole.methods.resetMember("1", zeroAddress).send({ from: account1 })));

    // Only the holder of the role should be able to modify it.
    assert(await didContractThrow(multiRole.methods.resetMember("1", account2).send({ from: account2 })));
    await multiRole.methods.resetMember("1", account2).send({ from: account1 });

    // account2 should now be the holder of the role.
    assert.isFalse(await multiRole.methods.holdsRole("1", account1).call());
    assert.isTrue(await multiRole.methods.holdsRole("1", account2).call());
    assert.equal(await multiRole.methods.getMember("1").call(), account2);
    await multiRole.methods.revertIfNotHoldingRole("1").send({ from: account2 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("1").send({ from: account1 })));

    // Cannot renounce an exclusive role.
    assert(await didContractThrow(multiRole.methods.renounceMembership("1").send({ from: account2 })));
  });

  it("Exclusive externally managed role", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] });

    // Roles can only be managed by previously created roles.
    assert(
      await didContractThrow(multiRole.methods.createExclusiveRole("2", "3", account1).send({ from: accounts[0] }))
    );
    await multiRole.methods.createExclusiveRole("2", "1", account2).send({ from: accounts[0] });

    // Check that only the account2 is the holder of the role.
    assert.isTrue(await multiRole.methods.holdsRole("2", account2).call());
    assert.isFalse(await multiRole.methods.holdsRole("2", account1).call());
    assert.equal(await multiRole.methods.getMember("2").call(), account2);
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account1 })));

    // Cannot renounce an exclusive role.
    assert(await didContractThrow(multiRole.methods.renounceMembership("2").send({ from: account2 })));

    // Only the holder of the managing role should be able to modify it.
    assert(await didContractThrow(multiRole.methods.resetMember("2", account1).send({ from: account2 })));
    await multiRole.methods.resetMember("2", account1).send({ from: account1 });

    // account1 should now be the holder of the role.
    assert.isFalse(await multiRole.methods.holdsRole("2", account2).call());
    assert.isTrue(await multiRole.methods.holdsRole("2", account1).call());
    assert.equal(await multiRole.methods.getMember("2").call(), account1);
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account1 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 })));
  });

  it("Shared self-managed role", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createSharedRole("1", "1", [account1, account2]).send({ from: accounts[0] });

    // Exclusive methods should fail.
    assert(await didContractThrow(multiRole.methods.resetMember("1", account3).send({ from: account1 })));
    assert(await didContractThrow(multiRole.methods.getMember("1").send({ from: accounts[0] })));

    // Create methods should fail.
    assert(
      await didContractThrow(multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(multiRole.methods.createSharedRole("1", "1", [account1]).send({ from: accounts[0] }))
    );

    // Check that only the account1 and account2 are holders of the role.
    assert.isTrue(await multiRole.methods.holdsRole("1", account1).call());
    assert.isTrue(await multiRole.methods.holdsRole("1", account2).call());
    await multiRole.methods.revertIfNotHoldingRole("1").send({ from: account1 });
    await multiRole.methods.revertIfNotHoldingRole("1").send({ from: account2 });

    // Anyone who holds the role should be able to add members.
    assert(await didContractThrow(multiRole.methods.addMember("1", account3).send({ from: account3 })));
    await multiRole.methods.addMember("1", account3).send({ from: account2 });
    assert.isTrue(await multiRole.methods.holdsRole("1", account3).call());
    await multiRole.methods.revertIfNotHoldingRole("1").send({ from: account3 });

    // Cannot set a shared role role to the 0x0 address.
    assert(await didContractThrow(multiRole.methods.addMember("1", zeroAddress).send({ from: account2 })));

    // Anyone who holds the role should be able to remove members.
    await multiRole.methods.removeMember("1", account2).send({ from: account3 });
    assert.isFalse(await multiRole.methods.holdsRole("1", account2).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("1").send({ from: account2 })));

    // Any shared role holder can renounce their membership.
    await multiRole.methods.renounceMembership("1").send({ from: account3 });
    assert.isFalse(await multiRole.methods.holdsRole("1", account3).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("1").send({ from: account3 })));
  });

  it("Shared externally-managed (shared) role", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createSharedRole("1", "1", [account1, account4]).send({ from: accounts[0] });

    // Roles can only be managed by previously created roles.
    assert(
      await didContractThrow(
        multiRole.methods.createSharedRole("2", "3", [account1, account2, account3]).send({ from: accounts[0] })
      )
    );
    await multiRole.methods.createSharedRole("2", "1", [account1, account2, account3]).send({ from: accounts[0] });

    // Check that only account1, account2, and account3 are holders of the role.
    assert.isTrue(await multiRole.methods.holdsRole("2", account1).call());
    assert.isTrue(await multiRole.methods.holdsRole("2", account2).call());
    assert.isTrue(await multiRole.methods.holdsRole("2", account3).call());
    assert.isFalse(await multiRole.methods.holdsRole("2", account4).call());
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account1 });
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 });
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account3 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account4 })));

    // Anyone who holds the managing role should be able to add members.
    assert(await didContractThrow(multiRole.methods.addMember("2", account4).send({ from: account2 })));
    await multiRole.methods.addMember("2", account4).send({ from: account4 });
    assert.isTrue(await multiRole.methods.holdsRole("2", account4).call());
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account4 });

    // Anyone who holds the managing role should be able to remove members.
    assert(await didContractThrow(multiRole.methods.removeMember("2", account2).send({ from: account2 })));
    await multiRole.methods.removeMember("2", account2).send({ from: account1 });
    assert.isFalse(await multiRole.methods.holdsRole("2", account2).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 })));

    // Any shared role holder can renounce their membership, even if they do not hold the managing role.
    assert(await didContractThrow(multiRole.methods.renounceMembership("2").send({ from: account2 })));
    await multiRole.methods.renounceMembership("2").send({ from: account3 });
    assert.isFalse(await multiRole.methods.holdsRole("2", account3).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account3 })));
  });

  it("Shared externally-managed (exclusive) role", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] });
    await multiRole.methods.createSharedRole("2", "1", [account2, account3]).send({ from: accounts[0] });

    // Check that only the account2 and account3 are holders of the role.
    assert.isTrue(await multiRole.methods.holdsRole("2", account2).call());
    assert.isTrue(await multiRole.methods.holdsRole("2", account3).call());
    assert.isFalse(await multiRole.methods.holdsRole("2", account1).call());
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 });
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account3 });
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account1 })));

    // Anyone who holds the managing role should be able to add members.
    assert(await didContractThrow(multiRole.methods.addMember("2", account1).send({ from: account2 })));
    assert(await didContractThrow(multiRole.methods.addMember("2", account1).send({ from: account3 })));
    await multiRole.methods.addMember("2", account1).send({ from: account1 });
    assert.isTrue(await multiRole.methods.holdsRole("2", account1).call());
    await multiRole.methods.revertIfNotHoldingRole("2").send({ from: account1 });

    // Anyone who holds the managing role should be able to remove members.
    assert(await didContractThrow(multiRole.methods.removeMember("2", account2).send({ from: account2 })));
    assert(await didContractThrow(multiRole.methods.removeMember("2", account2).send({ from: account3 })));
    await multiRole.methods.removeMember("2", account2).send({ from: account1 });
    assert.isFalse(await multiRole.methods.holdsRole("2", account2).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account2 })));

    // Any shared role holder can renounce their membership, even if they do not hold the managing role.
    assert(await didContractThrow(multiRole.methods.renounceMembership("2").send({ from: account2 })));
    await multiRole.methods.renounceMembership("2").send({ from: account3 });
    assert.isFalse(await multiRole.methods.holdsRole("2", account3).call());
    assert(await didContractThrow(multiRole.methods.revertIfNotHoldingRole("2").send({ from: account3 })));
  });

  it("Events are emitted", async function () {
    const multiRole = await MultiRoleTest.new().send({ from: accounts[0] });
    await multiRole.methods.createExclusiveRole("1", "1", account1).send({ from: accounts[0] });
    await multiRole.methods.createSharedRole("2", "1", [account2, account3]).send({ from: accounts[0] });

    // Add shared member.
    const addSharedResult = await multiRole.methods.addMember("2", account4).send({ from: account1 });
    await assertEventEmitted(addSharedResult, multiRole, "AddedSharedMember", (ev) => {
      return ev.roleId.toString() == "2" && ev.newMember == account4 && ev.manager == account1;
    });

    // Remove shared member.
    const removeSharedResult = await multiRole.methods.removeMember("2", account4).send({ from: account1 });
    await assertEventEmitted(removeSharedResult, multiRole, "RemovedSharedMember", (ev) => {
      return ev.roleId.toString() == "2" && ev.oldMember == account4 && ev.manager == account1;
    });

    // Renounce shared member.
    const renounceSharedResult = await multiRole.methods.renounceMembership("2").send({ from: account2 });
    await assertEventEmitted(renounceSharedResult, multiRole, "RemovedSharedMember", (ev) => {
      return ev.roleId.toString() == "2" && ev.oldMember == account2 && ev.manager == account2;
    });

    // Reset exclusive member.
    const resetMemberResult = await multiRole.methods.resetMember("1", account2).send({ from: account1 });
    await assertEventEmitted(resetMemberResult, multiRole, "ResetExclusiveMember", (ev) => {
      return ev.roleId.toString() == "1" && ev.newMember == account2 && ev.manager == account1;
    });
  });
});
