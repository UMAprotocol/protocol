const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const MultiRoleTest = artifacts.require("MultiRoleTest");

contract("MultiRole", function(accounts) {
  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  it("Exclusive Self-managed role", async function() {
    const multiRole = await MultiRoleTest.new();
    await multiRole.createExclusiveRole("1", "1", account1);

    // Shared methods should fail.
    assert(await didContractThrow(multiRole.addMember("1", account2, { from: account1 })));
    assert(await didContractThrow(multiRole.removeMember("1", account1, { from: account1 })));

    // Create methods should fail.
    assert(await didContractThrow(multiRole.createExclusiveRole("1", "1", account1)));
    assert(await didContractThrow(multiRole.createSharedRole("1", "1", [account1])));

    // Cannot call methods on roles that haven't been created.
    assert(await didContractThrow(multiRole.addMember("2", account2, { from: account1 })));
    assert(await didContractThrow(multiRole.removeMember("2", account2, { from: account1 })));
    assert(await didContractThrow(multiRole.resetMember("2", account2, { from: account1 })));
    assert(await didContractThrow(multiRole.getMember("2")));
    assert(await didContractThrow(multiRole.holdsRole("2", account2)));

    // Check that only the account1 is the holder of the role.
    assert.isTrue(await multiRole.holdsRole("1", account1));
    assert.isFalse(await multiRole.holdsRole("1", account2));
    assert.equal(await multiRole.getMember("1"), account1);
    await multiRole.revertIfNotHoldingRole("1", { from: account1 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("1", { from: account2 })));

    // Cannot set an exclusive role to the 0x0 address
    assert(await didContractThrow(multiRole.resetMember("1", zeroAddress, { from: account1 })));

    // Only the holder of the role should be able to modify it.
    assert(await didContractThrow(multiRole.resetMember("1", account2, { from: account2 })));
    await multiRole.resetMember("1", account2, { from: account1 });

    // account2 should now be the holder of the role.
    assert.isFalse(await multiRole.holdsRole("1", account1));
    assert.isTrue(await multiRole.holdsRole("1", account2));
    assert.equal(await multiRole.getMember("1"), account2);
    await multiRole.revertIfNotHoldingRole("1", { from: account2 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("1", { from: account1 })));
  });

  it("Exlusive externally managed role", async function() {
    const multiRole = await MultiRoleTest.new();
    await multiRole.createExclusiveRole("1", "1", account1);

    // Roles can only be managed by previously created roles.
    assert(await didContractThrow(multiRole.createExclusiveRole("2", "3", account1)));
    await multiRole.createExclusiveRole("2", "1", account2);

    // Check that only the account2 is the holder of the role.
    assert.isTrue(await multiRole.holdsRole("2", account2));
    assert.isFalse(await multiRole.holdsRole("2", account1));
    assert.equal(await multiRole.getMember("2"), account2);
    await multiRole.revertIfNotHoldingRole("2", { from: account2 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account1 })));

    // Only the holder of the managing role should be able to modify it.
    assert(await didContractThrow(multiRole.resetMember("2", account1, { from: account2 })));
    await multiRole.resetMember("2", account1, { from: account1 });

    // account1 should now be the holder of the role.
    assert.isFalse(await multiRole.holdsRole("2", account2));
    assert.isTrue(await multiRole.holdsRole("2", account1));
    assert.equal(await multiRole.getMember("2"), account1);
    await multiRole.revertIfNotHoldingRole("2", { from: account1 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account2 })));
  });

  it("Shared self-managed role", async function() {
    const multiRole = await MultiRoleTest.new();
    await multiRole.createSharedRole("1", "1", [account1, account2]);

    // Exclusive methods should fail.
    assert(await didContractThrow(multiRole.resetMember("1", account3, { from: account1 })));
    assert(await didContractThrow(multiRole.getMember("1")));

    // Create methods should fail.
    assert(await didContractThrow(multiRole.createExclusiveRole("1", "1", account1)));
    assert(await didContractThrow(multiRole.createSharedRole("1", "1", [account1])));

    // Check that only the account1 and account2 are holders of the role.
    assert.isTrue(await multiRole.holdsRole("1", account1));
    assert.isTrue(await multiRole.holdsRole("1", account2));
    await multiRole.revertIfNotHoldingRole("1", { from: account1 });
    await multiRole.revertIfNotHoldingRole("1", { from: account2 });

    // Anyone who holds the role should be able to add members.
    assert(await didContractThrow(multiRole.addMember("1", account3, { from: account3 })));
    await multiRole.addMember("1", account3, { from: account2 });
    assert.isTrue(await multiRole.holdsRole("1", account3));
    await multiRole.revertIfNotHoldingRole("1", { from: account3 });

    // Anyone who holds the role should be able to remove members.
    await multiRole.removeMember("1", account2, { from: account3 });
    assert.isFalse(await multiRole.holdsRole("1", account2));
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("1", { from: account2 })));
  });

  it("Shared externally-managed (shared) role", async function() {
    const multiRole = await MultiRoleTest.new();
    await multiRole.createSharedRole("1", "1", [account1, account3]);

    // Roles can only be managed by previously created roles.
    assert(await didContractThrow(multiRole.createSharedRole("2", "3", [account1, account2])));
    await multiRole.createSharedRole("2", "1", [account1, account2]);

    // Check that only the account1 and account2 are holders of the role.
    assert.isTrue(await multiRole.holdsRole("2", account1));
    assert.isTrue(await multiRole.holdsRole("2", account2));
    assert.isFalse(await multiRole.holdsRole("2", account3));
    await multiRole.revertIfNotHoldingRole("2", { from: account1 });
    await multiRole.revertIfNotHoldingRole("2", { from: account2 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account3 })));

    // Anyone who holds the managing role should be able to add members.
    assert(await didContractThrow(multiRole.addMember("2", account3, { from: account2 })));
    await multiRole.addMember("2", account3, { from: account3 });
    assert.isTrue(await multiRole.holdsRole("2", account3));
    await multiRole.revertIfNotHoldingRole("2", { from: account3 });

    // Anyone who holds the managing role should be able to remove members.
    assert(await didContractThrow(multiRole.removeMember("2", account2, { from: account2 })));
    await multiRole.removeMember("2", account2, { from: account1 });
    assert.isFalse(await multiRole.holdsRole("2", account2));
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account2 })));
  });

  it("Shared externally-managed (exclusive) role", async function() {
    const multiRole = await MultiRoleTest.new();
    await multiRole.createExclusiveRole("1", "1", account1);
    await multiRole.createSharedRole("2", "1", [account2, account3]);

    // Check that only the account2 and account3 are holders of the role.
    assert.isTrue(await multiRole.holdsRole("2", account2));
    assert.isTrue(await multiRole.holdsRole("2", account3));
    assert.isFalse(await multiRole.holdsRole("2", account1));
    await multiRole.revertIfNotHoldingRole("2", { from: account2 });
    await multiRole.revertIfNotHoldingRole("2", { from: account3 });
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account1 })));

    // Anyone who holds the managing role should be able to add members.
    assert(await didContractThrow(multiRole.addMember("2", account1, { from: account2 })));
    assert(await didContractThrow(multiRole.addMember("2", account1, { from: account3 })));
    await multiRole.addMember("2", account1, { from: account1 });
    assert.isTrue(await multiRole.holdsRole("2", account1));
    await multiRole.revertIfNotHoldingRole("2", { from: account1 });

    // Anyone who holds the managing role should be able to remove members.
    assert(await didContractThrow(multiRole.removeMember("2", account2, { from: account2 })));
    assert(await didContractThrow(multiRole.removeMember("2", account2, { from: account3 })));
    await multiRole.removeMember("2", account2, { from: account1 });
    assert.isFalse(await multiRole.holdsRole("2", account2));
    assert(await didContractThrow(multiRole.revertIfNotHoldingRole("2", { from: account2 })));
  });
});
