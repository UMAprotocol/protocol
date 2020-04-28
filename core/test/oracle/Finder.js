const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const Finder = artifacts.require("Finder");

const truffleAssert = require("truffle-assertions");

contract("Finder", function(accounts) {
  const owner = accounts[0];
  const user = accounts[1];

  it("General methods", async function() {
    const finder = await Finder.deployed();

    const interfaceName1 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface1"));
    const interfaceName2 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface2"));
    const implementationAddress1 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress2 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress3 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

    // Random users cannot change the implementation address.
    assert(
      await didContractThrow(finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: user }))
    );

    // Looking up unknown interfaces fails.
    assert(await didContractThrow(finder.getImplementationAddress(interfaceName1)));

    // Can set and then find an interface.
    await finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: owner });
    assert.equal(await finder.getImplementationAddress(interfaceName1, { from: user }), implementationAddress1);

    // Supports multiple interfaces.
    await finder.changeImplementationAddress(interfaceName2, implementationAddress2, { from: owner });
    assert.equal(await finder.getImplementationAddress(interfaceName1), implementationAddress1);
    assert.equal(await finder.getImplementationAddress(interfaceName2), implementationAddress2);

    // Can reset and then find an interface.
    const result = await finder.changeImplementationAddress(interfaceName1, implementationAddress3, { from: owner });
    truffleAssert.eventEmitted(result, "InterfaceImplementationChanged", ev => {
      return (
        web3.utils.hexToUtf8(ev.interfaceName) === web3.utils.hexToUtf8(web3.utils.bytesToHex(interfaceName1)) &&
        ev.newImplementationAddress === implementationAddress3
      );
    });
    assert.equal(await finder.getImplementationAddress(interfaceName1), implementationAddress3);
    assert.equal(await finder.getImplementationAddress(interfaceName2), implementationAddress2);
  });
});
