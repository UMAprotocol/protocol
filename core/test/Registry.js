const { didContractThrow } = require("./SolidityTestUtils.js");

const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");

contract("Registry", function(accounts) {
  // A deployed instance of the Registry contract, ready for testing.
  let registry;

  const owner = accounts[0];
  const creator1 = accounts[1];
  const creator2 = accounts[2];
  const rando1 = accounts[3];
  const rando2 = accounts[4];

  beforeEach(async function() {
    registry = await Registry.new();
  });

  const areAddressesEqual = (address1, address2) => {
    return address1.toLowerCase() === address2.toLowerCase();
  };

  it("Derivative creation", async function() {
    // No creators should be registered initially.
    assert.isNotTrue(await registry.isDerivativeCreatorAuthorized(creator1));

    // Only the owner should be able to add derivative creators.
    assert(await didContractThrow(registry.addDerivativeCreator(creator1, { from: rando1 })));

    // Register creator1, but not creator2.
    let result = await registry.addDerivativeCreator(creator1, { from: owner });
    assert.isTrue(await registry.isDerivativeCreatorAuthorized(creator1));
    assert.isFalse(await registry.isDerivativeCreatorAuthorized(creator2));

    // Ensure an AddDerivativeCreator event is logged.
    truffleAssert.eventEmitted(result, "AddDerivativeCreator", ev => {
      return web3.utils.toChecksumAddress(ev.addedDerivativeCreator) === web3.utils.toChecksumAddress(creator1);
    });

    // Add it a second time, but check that an event is not emitted.
    result = await registry.addDerivativeCreator(creator1, { from: owner });
    truffleAssert.eventNotEmitted(result, "AddDerivativeCreator");

    // Try to register an arbitrary contract.
    const arbitraryContract = web3.utils.randomHex(20);
    const parties = [web3.utils.randomHex(20), web3.utils.randomHex(20)];

    // Only approved creators can register contracts.
    assert(await didContractThrow(registry.registerDerivative(parties, arbitraryContract, { from: creator2 })));

    // creator1 should be able to register a new contract.
    result = await registry.registerDerivative(parties, arbitraryContract, { from: creator1 });
    assert.isTrue(await registry.isDerivativeRegistered(arbitraryContract));

    // Make sure a RegisterDerivative event is emitted.
    truffleAssert.eventEmitted(result, "RegisterDerivative", ev => {
      return web3.utils.toChecksumAddress(ev.derivativeAddress) === web3.utils.toChecksumAddress(arbitraryContract);
    });

    // Remove the derivative creator.
    result = await registry.removeDerivativeCreator(creator1, { from: owner });
    assert.isFalse(await registry.isDerivativeCreatorAuthorized(creator1));

    // Ensure an event was emitted.
    truffleAssert.eventEmitted(result, "RemoveDerivativeCreator", ev => {
      return web3.utils.toChecksumAddress(ev.removedDerivativeCreator) === web3.utils.toChecksumAddress(creator1);
    });

    // Creation should fail since creator1 is no longer approved.
    const secondContract = web3.utils.randomHex(20);
    assert(await didContractThrow(registry.registerDerivative(parties, secondContract, { from: creator1 })));

    // A second removal should not trigger another event.
    result = await registry.removeDerivativeCreator(creator1, { from: owner });
    truffleAssert.eventNotEmitted(result, "RemoveDerivativeCreator");
  });

  it("Register and query derivatives", async function() {
    await registry.addDerivativeCreator(creator1, { from: owner });
    await registry.addDerivativeCreator(creator2, { from: owner });

    // Register an arbitrary derivative.
    const derivative1 = web3.utils.randomHex(20);
    const derivative2 = web3.utils.randomHex(20);
    const derivative3 = web3.utils.randomHex(20);
    const party1 = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);
    const party3 = web3.utils.randomHex(20);

    // Register two derivatives with partially overlapping parties
    await registry.registerDerivative([party1, party2], derivative1, { from: creator1 });
    await registry.registerDerivative([party2, party3], derivative2, { from: creator2 });
    await registry.registerDerivative([], derivative3, { from: creator1 });

    // Query that derivative by party and ensure all parties see their correct derivatives.
    const party1Derivatives = await registry.getRegisteredDerivatives(party1);
    assert.equal(party1Derivatives.length, 1);
    assert.isTrue(areAddressesEqual(party1Derivatives[0].derivativeAddress, derivative1));
    assert.isTrue(areAddressesEqual(party1Derivatives[0].derivativeCreator, creator1));

    const party2Derivatives = await registry.getRegisteredDerivatives(party2);
    assert.equal(party2Derivatives.length, 2);
    assert.isTrue(areAddressesEqual(party2Derivatives[0].derivativeAddress, derivative1));
    assert.isTrue(areAddressesEqual(party2Derivatives[0].derivativeCreator, creator1));
    assert.isTrue(areAddressesEqual(party2Derivatives[1].derivativeAddress, derivative2));
    assert.isTrue(areAddressesEqual(party2Derivatives[1].derivativeCreator, creator2));

    const party3Derivatives = await registry.getRegisteredDerivatives(party3);
    assert.equal(party3Derivatives.length, 1);
    assert.isTrue(areAddressesEqual(party3Derivatives[0].derivativeAddress, derivative2));
    assert.isTrue(areAddressesEqual(party3Derivatives[0].derivativeCreator, creator2));

    const allDerivatives = await registry.getAllRegisteredDerivatives();
    assert.equal(allDerivatives.length, 3);
    assert.isTrue(areAddressesEqual(allDerivatives[0].derivativeAddress, derivative1));
    assert.isTrue(areAddressesEqual(allDerivatives[0].derivativeCreator, creator1));
    assert.isTrue(areAddressesEqual(allDerivatives[1].derivativeAddress, derivative2));
    assert.isTrue(areAddressesEqual(allDerivatives[1].derivativeCreator, creator2));
    assert.isTrue(areAddressesEqual(allDerivatives[2].derivativeAddress, derivative3));
    assert.isTrue(areAddressesEqual(allDerivatives[2].derivativeCreator, creator1));
  });

  it("Double-register derivative", async function() {
    // Approve creator.
    await registry.addDerivativeCreator(creator1, { from: owner });

    // Register derivative.
    const derivative1 = web3.utils.randomHex(20);
    await registry.registerDerivative([], derivative1, { from: creator1 });

    // Cannot register a derivative that is already registered.
    assert(await didContractThrow(registry.registerDerivative([], derivative1, { from: creator1 })));
  });
});
