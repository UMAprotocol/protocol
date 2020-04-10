const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");

contract("Registry", function(accounts) {
  // A deployed instance of the Registry contract, ready for testing.
  let registry;

  const owner = accounts[0];
  const creator1 = accounts[1];
  const creator2 = accounts[2];
  const rando1 = accounts[3];

  // The addition and removal of parties after a contract is created can only be done
  // by the contract itself. These two addresses act to simulate calls from a
  // registered contract to tests these post creation addition and removal actions.
  const contract1 = accounts[4];
  const contract2 = accounts[5];

  beforeEach(async function() {
    registry = await Registry.new();
  });

  const areAddressesEqual = (address1, address2) => {
    return address1.toLowerCase() === address2.toLowerCase();
  };

  it("Contract creation", async function() {
    // No creators should be registered initially.
    assert.isNotTrue(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1));

    // Only the owner should be able to add contract creators.
    assert(await didContractThrow(registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: rando1 })));

    // Register creator1, but not creator2.
    let result = await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });
    assert.isTrue(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1));
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator2));

    // Add it a second time.
    result = await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });

    // Try to register an arbitrary contract.
    const arbitraryContract = web3.utils.randomHex(20);
    const parties = [web3.utils.randomHex(20), web3.utils.randomHex(20)];

    // Only approved creators can register contracts.
    assert(await didContractThrow(registry.registerContract(parties, arbitraryContract, { from: creator2 })));

    // creator1 should be able to register a new contract.
    result = await registry.registerContract(parties, arbitraryContract, { from: creator1 });
    assert.isTrue(await registry.isContractRegistered(arbitraryContract));

    // Make sure a PartyAdded event is emitted on initial contract registration.
    truffleAssert.eventEmitted(result, "PartyAdded", ev => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(arbitraryContract) &&
        // Check that the party is a member of the parties array used in registration above
        parties.map(party => web3.utils.toChecksumAddress(party).indexOf(web3.utils.toChecksumAddress(ev.party)))
      );
    });

    // Make sure a NewContractRegistered event is emitted.
    truffleAssert.eventEmitted(result, "NewContractRegistered", ev => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(arbitraryContract) &&
        web3.utils.toChecksumAddress(ev.creator) === web3.utils.toChecksumAddress(creator1)
      );
    });

    // Remove the contract creator.
    result = await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });
    assert.isFalse(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1));

    // Creation should fail since creator1 is no longer approved.
    const secondContract = web3.utils.randomHex(20);
    assert(await didContractThrow(registry.registerContract(parties, secondContract, { from: creator1 })));

    // A second removal should still work.
    result = await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });

    // Remove the owner.
    await registry.resetMember(RegistryRolesEnum.OWNER, rando1, { from: owner });

    // The owner can no longer add or remove contract creators.
    assert(
      await didContractThrow(registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner }))
    );
  });

  it("Register and query contracts", async function() {
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator2, { from: owner });

    // Register arbitrary financial contracts.
    const fc1 = web3.utils.randomHex(20);
    const fc2 = web3.utils.randomHex(20);
    const fc3 = web3.utils.randomHex(20);
    const party1 = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);
    const party3 = web3.utils.randomHex(20);

    // Register three derivatives with partially overlapping parties
    await registry.registerContract([party1, party2], fc1, { from: creator1 });
    await registry.registerContract([party2, party3], fc2, { from: creator2 });
    await registry.registerContract([], fc3, { from: creator1 });

    // Query that contract by party and ensure all parties see their correct contracts.
    const party1Contracts = await registry.getRegisteredContracts(party1);
    assert.equal(party1Contracts.length, 1);
    assert.isTrue(areAddressesEqual(party1Contracts[0], fc1));

    const party2Contracts = await registry.getRegisteredContracts(party2);
    assert.equal(party2Contracts.length, 2);
    assert.isTrue(areAddressesEqual(party2Contracts[0], fc1));
    assert.isTrue(areAddressesEqual(party2Contracts[1], fc2));

    const party3Contracts = await registry.getRegisteredContracts(party3);
    assert.equal(party3Contracts.length, 1);
    assert.isTrue(areAddressesEqual(party3Contracts[0], fc2));

    const allContracts = await registry.getAllRegisteredContracts();
    assert.equal(allContracts.length, 3);
    assert.isTrue(areAddressesEqual(allContracts[0], fc1));
    assert.isTrue(areAddressesEqual(allContracts[1], fc2));
    assert.isTrue(areAddressesEqual(allContracts[2], fc3));

    // Check contract information.
    const financialContractStruct = await registry.contractMap(fc1);
    assert.equal(financialContractStruct.valid.toNumber(), 1);
    assert.equal(financialContractStruct.index.toNumber(), 0);

    // Check party is correctly added to contract.
    assert.isTrue(await registry.isPartyMemberOfContract(party2, fc1));
    assert.isFalse(await registry.isPartyMemberOfContract(rando1, fc1));
  });

  it("Double-register contract", async function() {
    // Approve creator.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });

    // Register contract.
    const fc1 = web3.utils.randomHex(20);
    await registry.registerContract([], fc1, { from: creator1 });

    // Cannot register a contract that is already registered.
    assert(await didContractThrow(registry.registerContract([], fc1, { from: creator1 })));

    // Cannot register the same address to a contract multiple times. In other words one
    // address cant be multiple party members of one contract at registration.
    const party = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);

    assert(
      await didContractThrow(registry.registerContract([party, party, party, party2], contract1, { from: creator1 }))
    );
  });

  it("Adding parties to contracts", async function() {
    // Approve creator and register contract.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });
    await registry.registerContract([], contract1, { from: creator1 });

    // Adding party member.
    let result = await registry.addPartyToContract(creator2, { from: contract1 });

    // Make sure a PartyMemberAdded event is emitted.
    truffleAssert.eventEmitted(result, "PartyAdded", ev => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(contract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check the party member was added to state.
    assert.isTrue(await registry.isPartyMemberOfContract(creator2, contract1));
    assert.isFalse(await registry.isPartyMemberOfContract(rando1, contract1));
    assert.equal((await registry.getRegisteredContracts(creator2)).length, 1);
    assert.equal((await registry.getRegisteredContracts(creator2))[0], contract1);

    // Cant add a member to a party more than once.
    assert(await didContractThrow(registry.addPartyToContract(creator2, { from: contract1 })));

    // Cant add a member to an invalid contract.
    assert(await didContractThrow(registry.addPartyToContract(creator2, { from: rando1 })));

    // Create a second contract and add it to the same user. Check that they are party of two.
    await registry.registerContract([], contract2, { from: creator1 });
    await registry.addPartyToContract(creator2, { from: contract2 });

    // Check that creator2 is part of two contracts.
    assert.isTrue(await registry.isPartyMemberOfContract(creator2, contract2));
    assert.isFalse(await registry.isPartyMemberOfContract(rando1, contract2));
    assert.equal((await registry.getRegisteredContracts(creator2)).length, 2);
    assert.equal((await registry.getRegisteredContracts(creator2))[0], contract1);
    assert.equal((await registry.getRegisteredContracts(creator2))[1], contract2);
  });

  it("Removing parties from contracts", async function() {
    // Approve creator and register two contract.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1, { from: owner });
    await registry.registerContract([], contract1, { from: creator1 });
    await registry.registerContract([], contract2, { from: creator1 });

    // Adding party member to both contracts.
    await registry.addPartyToContract(creator2, { from: contract1 });
    await registry.addPartyToContract(creator2, { from: contract2 });
    assert.equal((await registry.getRegisteredContracts(creator2)).length, 2);

    // Remove party member from the first contract and check they are part of only the second contract.
    let result = await registry.removePartyFromContract(creator2, { from: contract1 });

    truffleAssert.eventEmitted(result, "PartyRemoved", ev => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(contract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check party member has been removed from state.
    assert.isFalse(await registry.isPartyMemberOfContract(creator2, contract1));
    assert.isTrue(await registry.isPartyMemberOfContract(creator2, contract2));
    assert.equal((await registry.getRegisteredContracts(creator2)).length, 1);
    assert.equal((await registry.getRegisteredContracts(creator2))[0], contract2);

    // Cant remove a party from contract multiple times.
    assert(await didContractThrow(registry.removePartyFromContract(creator2, { from: contract1 })));

    // Cant remove a member to an invalid contract.
    assert(await didContractThrow(registry.removePartyFromContract(creator2, { from: rando1 })));

    // Remove party remember from second contract and check that they are part of none.
    await registry.removePartyFromContract(creator2, { from: contract2 });
    assert.equal((await registry.getRegisteredContracts(creator2)).length, 0);
    assert.isFalse(await registry.isPartyMemberOfContract(creator2, contract1));
    assert.isFalse(await registry.isPartyMemberOfContract(creator2, contract2));

    // Cant remove a contract if there is none left for the party.
    assert(await didContractThrow(registry.removePartyFromContract(creator2, { from: contract1 })));
  });
});
