const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const Finder = artifacts.require("Finder");

const truffleAssert = require("truffle-assertions");

contract("Finder", function(accounts) {
  const owner = accounts[0];
  const user = accounts[1];
  const rando = accounts[3];

  it("General methods", async function() {
    const finder = await Finder.deployed();

    const interfaceName1 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface1"));
    const interfaceName2 = web3.utils.hexToBytes(web3.utils.utf8ToHex("interface2"));

    // Create three contracts to use as dummy implementations to register in the finder.
    // It does not matter what contracts these are as long as they are not EOAs.
    const implementationAddress1 = (await Finder.new({ from: owner })).address;
    const implementationAddress2 = (await Finder.new({ from: owner })).address;
    const implementationAddress3 = (await Finder.new({ from: owner })).address;

    // Random users cannot change the implementation address.
    assert(
      await didContractThrow(finder.changeImplementationAddress(interfaceName1, implementationAddress1, { from: user }))
    );

    // Cant set the implementation address to an EOA; only contracts addresses can be registered in the finder
    assert(await didContractThrow(finder.changeImplementationAddress(interfaceName1, rando, { from: owner })));

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
