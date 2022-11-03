const hre = require("hardhat");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const IdentifierWhitelist = getContract("IdentifierWhitelist");

describe("IdentifierWhitelist", function () {
  let accounts;
  let owner;
  let rando;

  let identifierWhitelist;
  const randomIdentifierToAdd = web3.utils.utf8ToHex("random-identifier");

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
  });

  beforeEach(async function () {
    identifierWhitelist = await IdentifierWhitelist.new({ from: owner }).send({ from: accounts[0] });
  });

  it("Only Owner", async function () {
    // Rando cannot add to the whitelist.
    assert(
      await didContractThrow(
        identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: rando })
      )
    );

    // Owner can add to the whitelist.
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });

    // Rando cannot remove from the whitelist.
    assert(
      await didContractThrow(
        identifierWhitelist.methods.removeSupportedIdentifier(randomIdentifierToAdd).send({ from: rando })
      )
    );

    // Owner can remove from the whitelist.
    await identifierWhitelist.methods.removeSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
  });

  it("Add to whitelist", async function () {
    // Owner can add to the whitelist.
    const result = await identifierWhitelist.methods
      .addSupportedIdentifier(randomIdentifierToAdd)
      .send({ from: owner });

    await assertEventEmitted(result, identifierWhitelist, "SupportedIdentifierAdded", (ev) => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(randomIdentifierToAdd);
    });

    // Verify that the addition is reflected in isOnWhitelist().
    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());

    const incorrectIdentifier = web3.utils.utf8ToHex("wrong-identifier");
    assert.isFalse(await identifierWhitelist.methods.isIdentifierSupported(incorrectIdentifier).call());
  });

  it("Remove from whitelist", async function () {
    const identifierToRemove = web3.utils.utf8ToHex("remove-me");

    // Owner can add to the whitelist.
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifierToRemove).send({ from: owner });

    // Remove identifierToRemove
    let result = await identifierWhitelist.methods.removeSupportedIdentifier(identifierToRemove).send({ from: owner });

    await assertEventEmitted(result, identifierWhitelist, "SupportedIdentifierRemoved", (ev) => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifierToRemove);
    });

    // Verify that the additions and removal were applied correctly.
    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
    assert.isFalse(await identifierWhitelist.methods.isIdentifierSupported(identifierToRemove).call());

    // Double remove from whitelist. Shouldn't error, but shouldn't generate an event.
    result = await identifierWhitelist.methods.removeSupportedIdentifier(identifierToRemove).send({ from: owner });
    await assertEventNotEmitted(result, identifierWhitelist, "SupportedIdentifierRemoved");
  });

  it("Add to whitelist twice", async function () {
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    const result = await identifierWhitelist.methods
      .addSupportedIdentifier(randomIdentifierToAdd)
      .send({ from: owner });

    await assertEventNotEmitted(result, identifierWhitelist, "SupportedIdentifierAdded");

    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
  });

  it("Re-add to whitelist", async function () {
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    await identifierWhitelist.methods.removeSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });

    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
  });
});
