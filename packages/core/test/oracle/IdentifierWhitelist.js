const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");

const truffleAssert = require("truffle-assertions");

const IdentifierWhitelist = getContract("IdentifierWhitelist");

contract("IdentifierWhitelist", function (accounts) {
  const owner = accounts[0];
  const rando = accounts[1];

  let identifierWhitelist;
  let randomIdentifierToAdd;

  beforeEach(async function () {
    await runDefaultFixture(hre);
    identifierWhitelist = await IdentifierWhitelist.new({ from: owner }).send({ from: accounts[0] });
    randomIdentifierToAdd = web3.utils.utf8ToHex("random-identifier");
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
      .call({ from: owner });

    truffleAssert.eventEmitted(result, "SupportedIdentifierAdded", (ev) => {
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
    let result = await identifierWhitelist.methods.removeSupportedIdentifier(identifierToRemove).call({ from: owner });

    truffleAssert.eventEmitted(result, "SupportedIdentifierRemoved", (ev) => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifierToRemove);
    });

    // Verify that the additions and removal were applied correctly.
    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
    assert.isFalse(await identifierWhitelist.methods.isIdentifierSupported(identifierToRemove).call());

    // Double remove from whitelist. Shouldn't error, but shouldn't generate an event.
    result = await identifierWhitelist.methods.removeSupportedIdentifier(identifierToRemove).call({ from: owner });
    truffleAssert.eventNotEmitted(result, "SupportedIdentifierRemoved");
  });

  it("Add to whitelist twice", async function () {
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    const result = await identifierWhitelist.methods
      .addSupportedIdentifier(randomIdentifierToAdd)
      .call({ from: owner });

    truffleAssert.eventNotEmitted(result, "SupportedIdentifierAdded");

    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
  });

  it("Re-add to whitelist", async function () {
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    await identifierWhitelist.methods.removeSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(randomIdentifierToAdd).send({ from: owner });

    assert.isTrue(await identifierWhitelist.methods.isIdentifierSupported(randomIdentifierToAdd).call());
  });
});
