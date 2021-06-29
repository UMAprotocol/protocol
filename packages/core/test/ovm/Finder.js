/* External Imports */
const { web3, ethers } = require("hardhat");
const { utf8ToHex, toChecksumAddress, randomHex, padRight } = web3.utils;
const chai = require("chai");
const { solidity } = require("ethereum-waffle");
const { expect } = chai;

// Note: This test breaks with the rest of the repository's unit tests and uses Waffle + Ethers.js instead of web3
// (plus truffle-ish) data structures. This is only meant to demonstrate Waffle + Ethers.js and should probabkly be
// changed to web3 style eventually.
chai.use(solidity);

describe("Finder - Optimism", () => {
  const interfaceName1 = padRight(utf8ToHex("interface1"), 64);
  const interfaceName2 = padRight(utf8ToHex("interface2"), 64);
  const implementationAddress1 = toChecksumAddress(randomHex(20));
  const implementationAddress2 = toChecksumAddress(randomHex(20));

  let owner;
  let user;
  before("load accounts", async () => {
    [owner, user] = await ethers.getSigners();
  });

  let Finder;
  beforeEach("deploy Finder contract", async () => {
    const Factory__Finder = await ethers.getContractFactory("Finder");
    Finder = await Factory__Finder.connect(owner).deploy();

    await Finder.deployTransaction.wait();
  });

  it("should revert when non-owner tries to change the implementation address", async () => {
    const tx = Finder.connect(user).changeImplementationAddress(interfaceName1, implementationAddress1);
    await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should revert when looking up unknown implementation address", async () => {
    const tx = Finder.connect(user).getImplementationAddress(interfaceName1);
    await expect(tx).to.be.revertedWith("Implementation not found");
  });

  it("Can set, find, and reset multiple interfaces", async () => {
    let tx = await Finder.connect(owner).changeImplementationAddress(interfaceName1, implementationAddress1);
    await tx.wait();
    expect(await Finder.getImplementationAddress(interfaceName1)).to.equal(implementationAddress1);
    expect(tx).to.emit(Finder, "InterfaceImplementationChanged").withArgs(interfaceName1, implementationAddress1);

    // Supports multiple interfaces:
    tx = await Finder.connect(owner).changeImplementationAddress(interfaceName2, implementationAddress2);
    await tx.wait();
    expect(await Finder.getImplementationAddress(interfaceName1)).to.equal(implementationAddress1);
    expect(await Finder.getImplementationAddress(interfaceName2)).to.equal(implementationAddress2);

    // Can reset an interface:
    tx = await Finder.connect(owner).changeImplementationAddress(interfaceName1, implementationAddress2);
    await tx.wait();
    expect(await Finder.getImplementationAddress(interfaceName1)).to.equal(implementationAddress2);
  });
});
