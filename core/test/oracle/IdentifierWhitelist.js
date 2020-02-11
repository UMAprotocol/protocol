const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const truffleAssert = require("truffle-assertions");

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

contract("IdentifierWhitelist", function(accounts) {
  const owner = accounts[0];
  const rando = accounts[1];

  let identifierWhitelist;
  let randomIdentifierToAdd;

  beforeEach(async function() {
    identifierWhitelist = await IdentifierWhitelist.new({ from: owner });
    randomIdentifierToAdd = web3.utils.utf8ToHex("random-identifier");
  });

  it("Only Owner", async function() {
    // Rando cannot add to the whitelist.
    assert(await didContractThrow(identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: rando })));

    // Owner can add to the whitelist.
    await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });

    // Rando cannot remove from the whitelist.
    assert(
      await didContractThrow(identifierWhitelist.removeSupportedIdentifier(randomIdentifierToAdd, { from: rando }))
    );

    // Owner can remove from the whitelist.
    await identifierWhitelist.removeSupportedIdentifier(randomIdentifierToAdd, { from: owner });
  });

  it("Add to whitelist", async function() {
    // Owner can add to the whitelist.
    const result = await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });

    truffleAssert.eventEmitted(result, "SupportedIdentifierAdded", ev => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(randomIdentifierToAdd);
    });

    // Verify that the addition is reflected in isOnWhitelist().
    assert.isTrue(await identifierWhitelist.isIdentifierSupported(randomIdentifierToAdd));

    const incorrectIdentifier = web3.utils.utf8ToHex("wrong-identifier");
    assert.isFalse(await identifierWhitelist.isIdentifierSupported(incorrectIdentifier));
  });

  it("Remove from whitelist", async function() {
    const identifierToRemove = web3.utils.utf8ToHex("remove-me");

    // Owner can add to the whitelist.
    await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });
    await identifierWhitelist.addSupportedIdentifier(identifierToRemove, { from: owner });

    // Remove identifierToRemove
    let result = await identifierWhitelist.removeSupportedIdentifier(identifierToRemove, { from: owner });

    truffleAssert.eventEmitted(result, "SupportedIdentifierRemoved", ev => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifierToRemove);
    });

    // Verify that the additions and removal were applied correctly.
    assert.isTrue(await identifierWhitelist.isIdentifierSupported(randomIdentifierToAdd));
    assert.isFalse(await identifierWhitelist.isIdentifierSupported(identifierToRemove));

    // Double remove from whitelist. Shouldn't error, but shouldn't generate an event.
    result = await identifierWhitelist.removeSupportedIdentifier(identifierToRemove, { from: owner });
    truffleAssert.eventNotEmitted(result, "SupportedIdentifierRemoved");
  });

  it("Add to whitelist twice", async function() {
    await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });
    const result = await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });

    truffleAssert.eventNotEmitted(result, "SupportedIdentifierAdded");

    assert.isTrue(await identifierWhitelist.isIdentifierSupported(randomIdentifierToAdd));
  });

  it("Re-add to whitelist", async function() {
    await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });
    await identifierWhitelist.removeSupportedIdentifier(randomIdentifierToAdd, { from: owner });
    await identifierWhitelist.addSupportedIdentifier(randomIdentifierToAdd, { from: owner });

    assert.isTrue(await identifierWhitelist.isIdentifierSupported(randomIdentifierToAdd));
  });
});
