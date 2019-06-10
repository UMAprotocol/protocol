const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { RegistryRolesEnum } = require("../utils/Enums.js");

const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");

contract("Registry", function(accounts) {
  // A deployed instance of the Registry contract, ready for testing.
  let registry;

  const governance = accounts[0];
  const writer = accounts[1];
  const creator1 = accounts[2];
  const creator2 = accounts[3];
  const rando1 = accounts[4];
  const rando2 = accounts[5];

  beforeEach(async function() {
    registry = await Registry.new();
    await registry.resetMember(RegistryRolesEnum.WRITER, writer);
  });

  const areAddressesEqual = (address1, address2) => {
    return address1.toLowerCase() === address2.toLowerCase();
  };

  it("Initialize roles", async function() {
    // Calling public initializeRolesOnce method fails.
    assert(await didContractThrow(registry.initializeRolesOnce()));
  });

  it("Derivative creation", async function() {
    // No creators should be registered initially.
    assert.isNotTrue(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));

    // Only the writer should be able to add derivative creators.
    assert(
      await didContractThrow(registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: rando1 }))
    );
    assert(
      await didContractThrow(registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: governance }))
    );

    // Register creator1, but not creator2.
    let result = await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });
    assert.isTrue(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator2));

    // Add it a second time.
    result = await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });

    // Try to register an arbitrary contract.
    const arbitraryContract = web3.utils.randomHex(20);
    const parties = [web3.utils.randomHex(20), web3.utils.randomHex(20)];

    // Only approved creators can register contracts.
    assert(await didContractThrow(registry.registerDerivative(parties, arbitraryContract, { from: creator2 })));

    // creator1 should be able to register a new contract.
    result = await registry.registerDerivative(parties, arbitraryContract, { from: creator1 });
    assert.isTrue(await registry.isDerivativeRegistered(arbitraryContract));

    // Make sure a NewDerivativeRegistered event is emitted.
    truffleAssert.eventEmitted(result, "NewDerivativeRegistered", ev => {
      return web3.utils.toChecksumAddress(ev.derivativeAddress) === web3.utils.toChecksumAddress(arbitraryContract);
    });

    // Remove the derivative creator.
    result = await registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));

    // Creation should fail since creator1 is no longer approved.
    const secondContract = web3.utils.randomHex(20);
    assert(await didContractThrow(registry.registerDerivative(parties, secondContract, { from: creator1 })));

    // A second removal should still work.
    result = await registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });

    // Remove the writer.
    await registry.resetMember(RegistryRolesEnum.WRITER, governance, { from: governance });

    // The writer can no longer add or remove derivative creators.
    assert(
      await didContractThrow(registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer }))
    );
    assert(
      await didContractThrow(registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer }))
    );
  });

  it("Register and query derivatives", async function() {
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator2, { from: writer });

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
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: writer });

    // Register derivative.
    const derivative1 = web3.utils.randomHex(20);
    await registry.registerDerivative([], derivative1, { from: creator1 });

    // Cannot register a derivative that is already registered.
    assert(await didContractThrow(registry.registerDerivative([], derivative1, { from: creator1 })));
  });
});
