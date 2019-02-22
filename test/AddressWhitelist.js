const { didContractThrow } = require("./utils/DidContractThrow.js");

const AddressWhitelist = artifacts.require("AddressWhitelist");

contract("AddressWhitelist", function(accounts) {
  const owner = accounts[0];
  const rando = accounts[1];

  let addressWhitelist;

  beforeEach(async function() {
    addressWhitelist = await AddressWhitelist.new({ from: owner });
  });

  it("Only Owner", async function() {
    const contractToAdd = web3.utils.randomHex(20);

    // Rando cannot add to the whitelist.
    assert(await didContractThrow(addressWhitelist.addToWhitelist(contractToAdd, { from: rando })));

    // Owner can add to the whitelist.
    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });

    // Rando cannot remove from the whitelist.
    assert(await didContractThrow(addressWhitelist.removeFromWhitelist(contractToAdd, { from: rando })));

    // Owner can remove from the whitelist.
    await addressWhitelist.removeFromWhitelist(contractToAdd, { from: owner });
  });

  it("Add to whitelist", async function() {
    const contractToAdd = web3.utils.randomHex(20);

    // Owner can add to the whitelist.
    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });

    // Verify that the addition is reflected in isOnWhitelist().
    assert.isTrue(await addressWhitelist.isOnWhitelist(contractToAdd));

    const randoContract = web3.utils.randomHex(20);
    assert.isFalse(await addressWhitelist.isOnWhitelist(randoContract));
  });

  it("Remove from whitelist", async function() {
    const contractToAdd = web3.utils.randomHex(20);
    const contractToRemove = web3.utils.randomHex(20);

    // Owner can add to the whitelist.
    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });
    await addressWhitelist.addToWhitelist(contractToRemove, { from: owner });

    // Remove contractToRemove
    await addressWhitelist.removeFromWhitelist(contractToRemove, { from: owner });

    // Verify that the additions and removal were applied correctly.
    assert.isTrue(await addressWhitelist.isOnWhitelist(contractToAdd));
    assert.isFalse(await addressWhitelist.isOnWhitelist(contractToRemove));
  });

  it("Add to whitelist twice", async function() {
    const contractToAdd = web3.utils.randomHex(20);

    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });
    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });

    assert.isTrue(await addressWhitelist.isOnWhitelist(contractToAdd));
  });

  it("Re-add to whitelist", async function() {
    const contractToReAdd = web3.utils.randomHex(20);

    await addressWhitelist.addToWhitelist(contractToReAdd, { from: owner });
    await addressWhitelist.removeFromWhitelist(contractToReAdd, { from: owner });
    await addressWhitelist.addToWhitelist(contractToReAdd, { from: owner });

    assert.isTrue(await addressWhitelist.isOnWhitelist(contractToReAdd));
  });

  it("Retrieve whitelist", async function() {
    const contractToReAdd = web3.utils.randomHex(20);
    const contractToRemove = web3.utils.randomHex(20);
    const contractToAdd = web3.utils.randomHex(20);

    await addressWhitelist.addToWhitelist(contractToReAdd, { from: owner });
    await addressWhitelist.removeFromWhitelist(contractToReAdd, { from: owner });
    await addressWhitelist.addToWhitelist(contractToReAdd, { from: owner });

    await addressWhitelist.addToWhitelist(contractToRemove, { from: owner });
    await addressWhitelist.removeFromWhitelist(contractToRemove, { from: owner });

    await addressWhitelist.addToWhitelist(contractToAdd, { from: owner });

    const whitelist = await addressWhitelist.getWhitelist({ from: owner });
    assert(whitelist.length == 2);
    assert(whitelist.indexOf(web3.utils.toChecksumAddress(contractToReAdd)) != -1);
    assert(whitelist.indexOf(web3.utils.toChecksumAddress(contractToAdd)) != -1);
  });
});
