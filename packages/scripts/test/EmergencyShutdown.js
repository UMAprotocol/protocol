const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, web3 } = hre;
const EmergencyShutdown = require("../src/EmergencyShutdown");
const { assert } = require("chai");

const MockAdministratee = getContract("MockAdministratee");
const Finder = getContract("Finder");
const FinancialContractsAdmin = getContract("FinancialContractsAdmin");

describe("scripts/EmergencyShutdown.js", function () {
  let accounts;
  let owner;
  let finder;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
  });

  it("Emergency shutdown", async function () {
    const administratee = await MockAdministratee.new().send({ from: accounts[0] });

    // Call emergency shutdown
    await EmergencyShutdown.run(owner, administratee.options.address, finder, FinancialContractsAdmin.abi);

    // Emergency shutdown called.
    assert.equal((await administratee.methods.timesEmergencyShutdown().call()).toString(), "1");
  });
});
