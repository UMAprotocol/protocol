const { didContractThrow } = require("../../common/SolidityTestUtils.js");

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

    const interfaceName1 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface1"));
    const interfaceName2 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface2"));
    const implementationAddress1 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress2 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress3 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

    // The owner can't directly call the writer's methods.
    assert(
      await didContractThrow(
        finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: owner })
      )
    );
    // And random users, definitely not.
    assert(
      await didContractThrow(finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: user }))
    );

    // Looking up unknown interfaces fails.
    assert(await didContractThrow(finder.getImplementationAddress(interfaceName1)));

    // Can set and then find an interface.
    await finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: writer });
    assert.equal(await finder.getImplementationAddress(interfaceName1), implementationAddress1);

    // Supports multiple interfaces.
    await finder.changeImplementationAddress(interfaceName2, implementationAddress2, { from: writer });
    assert.equal(await finder.getImplementationAddress(interfaceName1), implementationAddress1);
    assert.equal(await finder.getImplementationAddress(interfaceName2), implementationAddress2);

    // Can reset and then find an interface.
    await finder.changeImplementationAddress(interfaceName1, implementationAddress3, { from: writer });
    assert.equal(await finder.getImplementationAddress(interfaceName1), implementationAddress3);
    assert.equal(await finder.getImplementationAddress(interfaceName2), implementationAddress2);
  });
});
