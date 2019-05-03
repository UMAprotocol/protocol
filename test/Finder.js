const { didContractThrow } = require("./utils/DidContractThrow.js");

const Finder = artifacts.require("Finder");

contract("Finder", function(accounts) {
  const owner = accounts[0];
  const writer = accounts[1];
  const user = accounts[2];

  // Corresponds to Finder.Roles.Writer;
  const RolesEnumWriter = "1";

  it("General methods", async function() {
    const finder = await Finder.new({ from: owner });
    await finder.resetMember(RolesEnumWriter, writer, { from: owner });

    const implementationAddress1 = web3.utils.toChecksumAddress("0xc1912fEE45d61C87Cc5EA59DaE31190FFFFf232d");
    const implementationAddress2 = web3.utils.toChecksumAddress("0xCB1Db113894E507041E01e3Ef278f33474bab3DD");
    const implementationAddress3 = web3.utils.toChecksumAddress("0x861e0EEC945269E82D4FFDD8655E9eD320Ec7FA1");

    // The owner can't directly call the writer's methods.
    assert(
      await didContractThrow(finder.changeImplementationAddress("interface1", implementationAddress1, { from: owner }))
    );
    // And random users, definitely not.
    assert(
      await didContractThrow(finder.changeImplementationAddress("interface1", implementationAddress1, { from: user }))
    );

    // Looking up unknown interfaces fails.
    assert(await didContractThrow(finder.getImplementationAddress("interface1")));

    // Can set and then find an interface.
    await finder.changeImplementationAddress("interface1", implementationAddress1, { from: writer });
    assert.equal(await finder.getImplementationAddress("interface1"), implementationAddress1);

    // Supports multiple interfaces.
    await finder.changeImplementationAddress("interface2", implementationAddress2, { from: writer });
    assert.equal(await finder.getImplementationAddress("interface1"), implementationAddress1);
    assert.equal(await finder.getImplementationAddress("interface2"), implementationAddress2);

    // Can reset and then find an interface.
    await finder.changeImplementationAddress("interface1", implementationAddress3, { from: writer });
    assert.equal(await finder.getImplementationAddress("interface1"), implementationAddress3);
    assert.equal(await finder.getImplementationAddress("interface2"), implementationAddress2);
  });
});
