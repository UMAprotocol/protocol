/* External Imports */
const { web3, artifacts } = require("hardhat");
const { didContractThrow } = require("@uma/common");
const { utf8ToHex, hexToUtf8, toChecksumAddress, randomHex, padRight } = web3.utils;
const Finder = artifacts.readArtifactSync("Finder");

describe("Finder - Optimism", () => {
  const interfaceName1 = padRight(utf8ToHex("interface1"), 64);
  const interfaceName2 = padRight(utf8ToHex("interface2"), 64);
  const implementationAddress1 = toChecksumAddress(randomHex(20));
  const implementationAddress2 = toChecksumAddress(randomHex(20));
  const FinderContract = new web3.eth.Contract(Finder.abi);

  let owner;
  let user;
  before("load accounts", async () => {
    [owner, user] = await web3.eth.getAccounts();
  });

  let finder;
  beforeEach("deploy Finder contract", async () => {
    finder = await FinderContract.deploy({ data: Finder.bytecode }).send({ from: owner });
  });

  it("should revert when non-owner tries to change the implementation address", async () => {
    assert(
      await didContractThrow(
        finder.methods.changeImplementationAddress(interfaceName1, implementationAddress1).send({ from: user })
      )
    );
  });

  it("should revert when looking up unknown implementation address", async () => {
    assert(await didContractThrow(finder.methods.getImplementationAddress(interfaceName1).call()));
  });

  it("Can set, find, and reset multiple interfaces", async () => {
    const tx = await finder.methods
      .changeImplementationAddress(interfaceName1, implementationAddress1)
      .send({ from: owner });
    const events = await finder.getPastEvents("InterfaceImplementationChanged", {
      fromBlock: tx.blockNumber,
      toBlock: tx.blockNumber,
    });
    assert.equal(events[0].event, "InterfaceImplementationChanged");
    assert.equal(hexToUtf8(events[0].returnValues.interfaceName), hexToUtf8(interfaceName1));
    assert.equal(events[0].returnValues.newImplementationAddress, implementationAddress1);
    assert.equal(await finder.methods.getImplementationAddress(interfaceName1).call(), implementationAddress1);

    // Supports multiple interfaces:
    await finder.methods.changeImplementationAddress(interfaceName2, implementationAddress2).send({ from: owner });
    assert.equal(await finder.methods.getImplementationAddress(interfaceName2).call(), implementationAddress2);

    // Can reset an interface:
    await finder.methods.changeImplementationAddress(interfaceName1, implementationAddress2).send({ from: owner });
    assert.equal(await finder.methods.getImplementationAddress(interfaceName1).call(), implementationAddress2);
  });
});
