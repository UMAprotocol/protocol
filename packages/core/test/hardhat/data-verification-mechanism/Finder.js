const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { utf8ToHex } = web3.utils;
const { assert } = require("chai");

const Finder = getContract("Finder");

describe("Finder", function () {
  let accounts;
  let owner;
  let user;

  let finder;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, user] = accounts;

    finder = await Finder.new().send({ from: owner });
  });

  it("General methods", async function () {
    const interfaceName1 = utf8ToHex("interface1");
    const interfaceName2 = utf8ToHex("interface2");
    const implementationAddress1 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress2 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
    const implementationAddress3 = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

    // Random users cannot change the implementation address.
    assert(
      await didContractThrow(
        finder.methods.changeImplementationAddress(interfaceName1, implementationAddress1).send({ from: user })
      )
    );

    // Looking up unknown interfaces fails.
    assert(await didContractThrow(finder.methods.getImplementationAddress(interfaceName1).send({ from: accounts[0] })));

    // Can set and then find an interface.
    await finder.methods.changeImplementationAddress(interfaceName1, implementationAddress1).send({ from: owner });
    assert.equal(
      await finder.methods.getImplementationAddress(interfaceName1).call({ from: user }),
      implementationAddress1
    );

    // Supports multiple interfaces.
    await finder.methods.changeImplementationAddress(interfaceName2, implementationAddress2).send({ from: owner });
    assert.equal(await finder.methods.getImplementationAddress(interfaceName1).call(), implementationAddress1);
    assert.equal(await finder.methods.getImplementationAddress(interfaceName2).call(), implementationAddress2);

    // Can reset and then find an interface.
    const result = await finder.methods
      .changeImplementationAddress(interfaceName1, implementationAddress3)
      .send({ from: owner });
    assertEventEmitted(result, finder, "InterfaceImplementationChanged", (ev) => {
      return (
        web3.utils.hexToUtf8(ev.interfaceName) === web3.utils.hexToUtf8(interfaceName1) &&
        ev.newImplementationAddress === implementationAddress3
      );
    });
    assert.equal(await finder.methods.getImplementationAddress(interfaceName1).call(), implementationAddress3);
    assert.equal(await finder.methods.getImplementationAddress(interfaceName2).call(), implementationAddress2);
  });
});
