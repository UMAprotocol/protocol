const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { RegistryRolesEnum, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const Registry = getContract("Registry");

describe("Registry", function () {
  // A deployed instance of the Registry contract, ready for testing.
  let registry;

  let accounts;
  let owner;
  let creator1;
  let creator2;
  let rando1;

  // The addition and removal of parties after a contract is created can only be done
  // by the contract itself. These two addresses act to simulate calls from a
  // registered contract to tests these post creation addition and removal actions.
  let contract1;
  let contract2;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, creator1, creator2, rando1, contract1, contract2] = accounts;
  });

  beforeEach(async function () {
    registry = await Registry.new().send({ from: accounts[0] });
  });

  const areAddressesEqual = (address1, address2) => {
    return address1.toLowerCase() === address2.toLowerCase();
  };

  it("Contract creation", async function () {
    // No creators should be registered initially.
    assert.isNotTrue(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1).call());

    // Only the owner should be able to add contract creators.
    assert(
      await didContractThrow(
        registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: rando1 })
      )
    );

    // Register creator1, but not creator2.
    let result = await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });
    assert.isTrue(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1).call());
    assert.isFalse(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator2).call());

    // Add it a second time.
    result = await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });

    // Try to register an arbitrary contract.
    const arbitraryContract = web3.utils.randomHex(20);
    const parties = [web3.utils.randomHex(20), web3.utils.randomHex(20)];

    // Only approved creators can register contracts.
    assert(
      await didContractThrow(registry.methods.registerContract(parties, arbitraryContract).send({ from: creator2 }))
    );

    // creator1 should be able to register a new contract.
    result = await registry.methods.registerContract(parties, arbitraryContract).send({ from: creator1 });
    assert.isTrue(await registry.methods.isContractRegistered(arbitraryContract).call());

    // Make sure a PartyAdded event is emitted on initial contract registration.
    await assertEventEmitted(result, registry, "PartyAdded", (ev) => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(arbitraryContract) && // Check that the party is a member of the parties array used in registration above
        parties.map((party) => web3.utils.toChecksumAddress(party).indexOf(web3.utils.toChecksumAddress(ev.party)))
      );
    });

    // Make sure a NewContractRegistered event is emitted.
    await assertEventEmitted(result, registry, "NewContractRegistered", (ev) => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(arbitraryContract) &&
        web3.utils.toChecksumAddress(ev.creator) === web3.utils.toChecksumAddress(creator1)
      );
    });

    // Remove the contract creator.
    result = await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });
    assert.isFalse(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, creator1).call());

    // Creation should fail since creator1 is no longer approved.
    const secondContract = web3.utils.randomHex(20);
    assert(await didContractThrow(registry.methods.registerContract(parties, secondContract).send({ from: creator1 })));

    // A second removal should still work.
    result = await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });

    // Remove the owner.
    await registry.methods.resetMember(RegistryRolesEnum.OWNER, rando1).send({ from: owner });

    // The owner can no longer add or remove contract creators.
    assert(
      await didContractThrow(
        registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner })
      )
    );
  });

  it("Register and query contracts", async function () {
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator2).send({ from: owner });

    // Register arbitrary financial contracts.
    const fc1 = web3.utils.randomHex(20);
    const fc2 = web3.utils.randomHex(20);
    const fc3 = web3.utils.randomHex(20);
    const party1 = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);
    const party3 = web3.utils.randomHex(20);

    // Register three derivatives with partially overlapping parties
    await registry.methods.registerContract([party1, party2], fc1).send({ from: creator1 });
    await registry.methods.registerContract([party2, party3], fc2).send({ from: creator2 });
    await registry.methods.registerContract([], fc3).send({ from: creator1 });

    // Query that contract by party and ensure all parties see their correct contracts.
    const party1Contracts = await registry.methods.getRegisteredContracts(party1).call();
    assert.equal(party1Contracts.length, 1);
    assert.isTrue(areAddressesEqual(party1Contracts[0], fc1));

    const party2Contracts = await registry.methods.getRegisteredContracts(party2).call();
    assert.equal(party2Contracts.length, 2);
    assert.isTrue(areAddressesEqual(party2Contracts[0], fc1));
    assert.isTrue(areAddressesEqual(party2Contracts[1], fc2));

    const party3Contracts = await registry.methods.getRegisteredContracts(party3).call();
    assert.equal(party3Contracts.length, 1);
    assert.isTrue(areAddressesEqual(party3Contracts[0], fc2));

    const allContracts = await registry.methods.getAllRegisteredContracts().call();
    assert.equal(allContracts.length, 3);
    assert.isTrue(areAddressesEqual(allContracts[0], fc1));
    assert.isTrue(areAddressesEqual(allContracts[1], fc2));
    assert.isTrue(areAddressesEqual(allContracts[2], fc3));

    // Check contract information.
    const financialContractStruct = await registry.methods.contractMap(fc1).call();
    assert.equal(parseInt(financialContractStruct.valid), 1);
    assert.equal(parseInt(financialContractStruct.index), 0);

    // Check party is correctly added to contract.
    assert.isTrue(await registry.methods.isPartyMemberOfContract(party2, fc1).call());
    assert.isFalse(await registry.methods.isPartyMemberOfContract(rando1, fc1).call());
  });

  it("Double-register contract", async function () {
    // Approve creator.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });

    // Register contract.
    const fc1 = web3.utils.randomHex(20);
    await registry.methods.registerContract([], fc1).send({ from: creator1 });

    // Cannot register a contract that is already registered.
    assert(await didContractThrow(registry.methods.registerContract([], fc1).send({ from: creator1 })));

    // Cannot register the same address to a contract multiple times. In other words one
    // address cant be multiple party members of one contract at registration.
    const party = web3.utils.randomHex(20);
    const party2 = web3.utils.randomHex(20);

    assert(
      await didContractThrow(
        registry.methods.registerContract([party, party, party, party2], contract1).send({ from: creator1 })
      )
    );
  });

  it("Adding parties to contracts", async function () {
    // Approve creator and register contract.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });
    await registry.methods.registerContract([], contract1).send({ from: creator1 });

    // Adding party member.
    let result = await registry.methods.addPartyToContract(creator2).send({ from: contract1 });

    // Make sure a PartyMemberAdded event is emitted.
    await assertEventEmitted(result, registry, "PartyAdded", (ev) => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(contract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check the party member was added to state.
    assert.isTrue(await registry.methods.isPartyMemberOfContract(creator2, contract1).call());
    assert.isFalse(await registry.methods.isPartyMemberOfContract(rando1, contract1).call());
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call()).length, 1);
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call())[0], contract1);

    // Cant add a member to a party more than once.
    assert(await didContractThrow(registry.methods.addPartyToContract(creator2).send({ from: contract1 })));

    // Cant add a member to an invalid contract.
    assert(await didContractThrow(registry.methods.addPartyToContract(creator2).send({ from: rando1 })));

    // Create a second contract and add it to the same user. Check that they are party of two.
    await registry.methods.registerContract([], contract2).send({ from: creator1 });
    await registry.methods.addPartyToContract(creator2).send({ from: contract2 });

    // Check that creator2 is part of two contracts.
    assert.isTrue(await registry.methods.isPartyMemberOfContract(creator2, contract2).call());
    assert.isFalse(await registry.methods.isPartyMemberOfContract(rando1, contract2).call());
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call()).length, 2);
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call())[0], contract1);
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call())[1], contract2);
  });

  it("Removing parties from contracts", async function () {
    // Approve creator and register two contract.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, creator1).send({ from: owner });
    await registry.methods.registerContract([], contract1).send({ from: creator1 });
    await registry.methods.registerContract([], contract2).send({ from: creator1 });

    // Adding party member to both contracts.
    await registry.methods.addPartyToContract(creator2).send({ from: contract1 });
    await registry.methods.addPartyToContract(creator2).send({ from: contract2 });
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call()).length, 2);

    // Remove party member from the first contract and check they are part of only the second contract.
    let result = await registry.methods.removePartyFromContract(creator2).send({ from: contract1 });

    await assertEventEmitted(result, registry, "PartyRemoved", (ev) => {
      return (
        web3.utils.toChecksumAddress(ev.contractAddress) === web3.utils.toChecksumAddress(contract1) &&
        web3.utils.toChecksumAddress(ev.party) === web3.utils.toChecksumAddress(creator2)
      );
    });

    // Check party member has been removed from state.
    assert.isFalse(await registry.methods.isPartyMemberOfContract(creator2, contract1).call());
    assert.isTrue(await registry.methods.isPartyMemberOfContract(creator2, contract2).call());
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call()).length, 1);
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call())[0], contract2);

    // Cant remove a party from contract multiple times.
    assert(await didContractThrow(registry.methods.removePartyFromContract(creator2).send({ from: contract1 })));

    // Cant remove a member to an invalid contract.
    assert(await didContractThrow(registry.methods.removePartyFromContract(creator2).send({ from: rando1 })));

    // Remove party remember from second contract and check that they are part of none.
    await registry.methods.removePartyFromContract(creator2).send({ from: contract2 });
    assert.equal((await registry.methods.getRegisteredContracts(creator2).call()).length, 0);
    assert.isFalse(await registry.methods.isPartyMemberOfContract(creator2, contract1).call());
    assert.isFalse(await registry.methods.isPartyMemberOfContract(creator2, contract2).call());

    // Cant remove a contract if there is none left for the party.
    assert(await didContractThrow(registry.methods.removePartyFromContract(creator2).send({ from: contract1 })));
  });
});
