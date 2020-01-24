const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { RegistryRolesEnum } = require("../../common/Enums.js");

const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");

contract("Registry", function(accounts) {
  // A deployed instance of the Registry contract, ready for testing.
  let registry;

  const owner = accounts[0];
  const creator1 = accounts[1];
  const creator2 = accounts[2];
  const rando1 = accounts[3];

  // The addition and removal of party members after a derivative is created can only be done
  // by the derivative contract its self. These two addresses act to simulate calls from a
  // registered derivative to tests these post creation addition and removal actions.
  const derivativeContract1 = accounts[4];
  const derivativeContract2 = accounts[5];

  beforeEach(async function() {
    registry = await Registry.new();
  });

  const areAddressesEqual = (address1, address2) => {
    return address1.toLowerCase() === address2.toLowerCase();
  };

  it("Derivative creation", async function() {
    // No creators should be registered initially.
    assert.isNotTrue(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));

    // Only the owner should be able to add derivative creators.
    assert(
      await didContractThrow(registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: rando1 }))
    );

    // Register creator1, but not creator2.
    let result = await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });
    assert.isTrue(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator2));

    // Add it a second time.
    result = await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });

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
      return (
        web3.utils.toChecksumAddress(ev.derivativeAddress) === web3.utils.toChecksumAddress(arbitraryContract) &&
        web3.utils.toChecksumAddress(ev.creator) === web3.utils.toChecksumAddress(creator1)
      );
    });

    // Remove the derivative creator.
    result = await registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1));

    // Creation should fail since creator1 is no longer approved.
    const secondContract = web3.utils.randomHex(20);
    assert(await didContractThrow(registry.registerDerivative(parties, secondContract, { from: creator1 })));

    // A second removal should still work.
    result = await registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });

    // Remove the owner.
    await registry.resetMember(RegistryRolesEnum.OWNER, rando1, { from: owner });

    // The owner can no longer add or remove derivative creators.
    assert(await didContractThrow(registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner })));
    assert(
      await didContractThrow(registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner }))
    );
  });

  it("Register and query derivatives", async function() {
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator2, { from: owner });

    // Register an arbitrary derivative.
    const derivative1 = web3.utils.randomHex(20);
    const derivative2 = web3.utils.randomHex(20);
    const derivative3 = web3.utils.randomHex(20);
    const party1 = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);
    const party3 = web3.utils.randomHex(20);

    // Register three derivatives with partially overlapping parties
    await registry.registerDerivative([party1, party2], derivative1, { from: creator1 });
    await registry.registerDerivative([party2, party3], derivative2, { from: creator2 });
    await registry.registerDerivative([], derivative3, { from: creator1 });

    // Query that derivative by party and ensure all parties see their correct derivatives.
    const party1Derivatives = await registry.getRegisteredDerivatives(party1);
    assert.equal(party1Derivatives.length, 1);
    assert.isTrue(areAddressesEqual(party1Derivatives[0], derivative1));

    const party2Derivatives = await registry.getRegisteredDerivatives(party2);
    assert.equal(party2Derivatives.length, 2);
    assert.isTrue(areAddressesEqual(party2Derivatives[0], derivative1));
    assert.isTrue(areAddressesEqual(party2Derivatives[1], derivative2));

    const party3Derivatives = await registry.getRegisteredDerivatives(party3);
    assert.equal(party3Derivatives.length, 1);
    assert.isTrue(areAddressesEqual(party3Derivatives[0], derivative2));

    const allDerivatives = await registry.getAllRegisteredDerivatives();
    assert.equal(allDerivatives.length, 3);
    assert.isTrue(areAddressesEqual(allDerivatives[0], derivative1));
    assert.isTrue(areAddressesEqual(allDerivatives[1], derivative2));
    assert.isTrue(areAddressesEqual(allDerivatives[2], derivative3));

    // Check derivative information.
    const derivativeStruct = await registry.addressToDerivatives(derivative1);
    assert.equal(derivativeStruct.valid.toNumber(), 1);
    assert.equal(derivativeStruct.index.toNumber(), 0);

    // Check party is correctly added to derivative.
    assert.isTrue(await registry.isPartyMemberOfDerivative(party2, derivative1));
    assert.isFalse(await registry.isPartyMemberOfDerivative(rando1, derivative1));
  });

  it("Double-register derivative", async function() {
    // Approve creator.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });

    // Register derivative.
    const derivative1 = web3.utils.randomHex(20);
    await registry.registerDerivative([], derivative1, { from: creator1 });

    // Cannot register a derivative that is already registered.
    assert(await didContractThrow(registry.registerDerivative([], derivative1, { from: creator1 })));
  });

  it("Adding party members to derivatives", async function() {
    // Approve creator and register derivative.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });
    await registry.registerDerivative([], derivativeContract1, { from: creator1 });

    // Adding party member.
    let result = await registry.addPartyToDerivative(creator2, { from: derivativeContract1 });

    // Make sure a PartyMemberAdded event is emitted.
    truffleAssert.eventEmitted(result, "PartyMemberAdded", ev => {
      return (
        web3.utils.toChecksumAddress(ev.derivativeAddress) === web3.utils.toChecksumAddress(derivativeContract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check the party member was added to state.
    assert.isTrue(await registry.isPartyMemberOfDerivative(creator2, derivativeContract1));
    assert.isFalse(await registry.isPartyMemberOfDerivative(rando1, derivativeContract1));
    assert.equal((await registry.getRegisteredDerivatives(creator2)).length, 1);
    assert.equal((await registry.getRegisteredDerivatives(creator2))[0], derivativeContract1);

    // Cant add a member to a party more than once.
    assert(await didContractThrow(registry.addPartyToDerivative(creator2, { from: derivativeContract1 })));

    // Cant add a member to an invalid derivative.
    assert(await didContractThrow(registry.addPartyToDerivative(creator2, { from: rando1 })));

    // Create a second derivative and add it to the same user. Check that they are party of two.
    await registry.registerDerivative([], derivativeContract2, { from: creator1 });
    await registry.addPartyToDerivative(creator2, { from: derivativeContract2 });

    // Check that creator2 is part of two derivatives.
    assert.isTrue(await registry.isPartyMemberOfDerivative(creator2, derivativeContract2));
    assert.isFalse(await registry.isPartyMemberOfDerivative(rando1, derivativeContract2));
    assert.equal((await registry.getRegisteredDerivatives(creator2)).length, 2);
    assert.equal((await registry.getRegisteredDerivatives(creator2))[0], derivativeContract1);
    assert.equal((await registry.getRegisteredDerivatives(creator2))[1], derivativeContract2);
  });

  it("Removing party members from derivatives", async function() {
    // Approve creator and register two derivative.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, creator1, { from: owner });
    await registry.registerDerivative([], derivativeContract1, { from: creator1 });
    await registry.registerDerivative([], derivativeContract2, { from: creator1 });

    // Adding party member to both derivatives.
    await registry.addPartyToDerivative(creator2, { from: derivativeContract1 });
    await registry.addPartyToDerivative(creator2, { from: derivativeContract2 });
    assert.equal((await registry.getRegisteredDerivatives(creator2)).length, 2);

    // Remove party member from the first derivative and check they are part of only the second derivative.
    let result = await registry.removePartyFromDerivative(creator2, { from: derivativeContract1 });

    truffleAssert.eventEmitted(result, "PartyMemberRemoved", ev => {
      return (
        web3.utils.toChecksumAddress(ev.derivativeAddress) === web3.utils.toChecksumAddress(derivativeContract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check party member has been removed from state.
    assert.isFalse(await registry.isPartyMemberOfDerivative(creator2, derivativeContract1));
    assert.isTrue(await registry.isPartyMemberOfDerivative(creator2, derivativeContract2));
    assert.equal((await registry.getRegisteredDerivatives(creator2)).length, 1);
    assert.equal((await registry.getRegisteredDerivatives(creator2))[0], derivativeContract2);

    // Cant remove a party from derivative multiple times.
    assert(await didContractThrow(registry.removePartyFromDerivative(creator2, { from: derivativeContract1 })));

    // Cant remove a member to an invalid derivative.
    assert(await didContractThrow(registry.removePartyFromDerivative(creator2, { from: rando1 })));

    // Remove party remember from second derivative and check that they are part of none.
    await registry.removePartyFromDerivative(creator2, { from: derivativeContract2 });
    assert.equal((await registry.getRegisteredDerivatives(creator2)).length, 0);
    assert.isFalse(await registry.isPartyMemberOfDerivative(creator2, derivativeContract1));
    assert.isFalse(await registry.isPartyMemberOfDerivative(creator2, derivativeContract2));

    // Cant remove a derivative if there is none left for the party.
    assert(await didContractThrow(registry.removePartyFromDerivative(creator2, { from: derivativeContract1 })));
  });
});
