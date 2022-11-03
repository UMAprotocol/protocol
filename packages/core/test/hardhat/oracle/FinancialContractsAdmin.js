const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const FinancialContractsAdmin = getContract("FinancialContractsAdmin");
const MockAdministratee = getContract("MockAdministratee");

describe("FinancialContractsAdmin", function () {
  let financialContractsAdmin;
  let mockAdministratee;

  let accounts;
  let owner;
  let rando;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
    await runDefaultFixture(hre);
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
  });
  beforeEach(async function () {
    mockAdministratee = await MockAdministratee.new().send({ from: accounts[0] });
  });

  it("pfc", async function () {
    // AdministrateeInterfaces must implement pfc().
    assert.equal((await mockAdministratee.methods.pfc().call()).toString(), "0");
  });
  it("Remargin", async function () {
    assert.equal(await mockAdministratee.methods.timesRemargined().call(), "0");

    // Can't call remargin without being the owner.
    assert(
      await didContractThrow(
        financialContractsAdmin.methods.callRemargin(mockAdministratee.options.address).send({ from: rando })
      )
    );

    // Change the owner and verify that remargin can be called.
    await financialContractsAdmin.methods.transferOwnership(rando).send({ from: accounts[0] });
    await financialContractsAdmin.methods.callRemargin(mockAdministratee.options.address).send({ from: rando });
    assert.equal(await mockAdministratee.methods.timesRemargined().call(), "1");

    // Return ownership to owner.
    await financialContractsAdmin.methods.transferOwnership(owner).send({ from: rando });
  });

  it("Emergency Shutdown", async function () {
    assert.equal(await mockAdministratee.methods.timesEmergencyShutdown().call(), "0");

    // Can't call emergencyShutdown without being the owner.
    assert(
      await didContractThrow(
        financialContractsAdmin.methods.callEmergencyShutdown(mockAdministratee.options.address).send({ from: rando })
      )
    );

    // Change the owner and verify that emergencyShutdown can be called.
    await financialContractsAdmin.methods.transferOwnership(rando).send({ from: accounts[0] });
    await financialContractsAdmin.methods
      .callEmergencyShutdown(mockAdministratee.options.address)
      .send({ from: rando });
    assert.equal(await mockAdministratee.methods.timesEmergencyShutdown().call(), "1");

    // Return ownership to owner.
    await financialContractsAdmin.methods.transferOwnership(owner).send({ from: rando });
  });
});
