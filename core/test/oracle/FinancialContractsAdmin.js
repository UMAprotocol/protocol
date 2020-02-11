const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const truffleAssert = require("truffle-assertions");

const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const MockAdministratee = artifacts.require("MockAdministratee");

contract("FinancialContractsAdmin", function(accounts) {
  let financialContractsAdmin;
  let mockAdministratee;

  const owner = accounts[0];
  const rando = accounts[1];

  beforeEach(async function() {
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
    mockAdministratee = await MockAdministratee.new();
  });

  it("Remargin", async function() {
    assert.equal(await mockAdministratee.timesRemargined(), "0");

    // Can't call remargin without being the owner.
    assert(await didContractThrow(financialContractsAdmin.callRemargin(mockAdministratee.address, { from: rando })));

    // Change the owner and verify that remargin can be called.
    await financialContractsAdmin.transferOwnership(rando);
    await financialContractsAdmin.callRemargin(mockAdministratee.address, { from: rando });
    assert.equal(await mockAdministratee.timesRemargined(), "1");

    // Return ownership to owner.
    await financialContractsAdmin.transferOwnership(owner, { from: rando });
  });

  it("Emergency Shutdown", async function() {
    assert.equal(await mockAdministratee.timesEmergencyShutdown(), "0");

    // Can't call emergencyShutdown without being the owner.
    assert(
      await didContractThrow(financialContractsAdmin.callEmergencyShutdown(mockAdministratee.address, { from: rando }))
    );

    // Change the owner and verify that emergencyShutdown can be called.
    await financialContractsAdmin.transferOwnership(rando);
    await financialContractsAdmin.callEmergencyShutdown(mockAdministratee.address, { from: rando });
    assert.equal(await mockAdministratee.timesEmergencyShutdown(), "1");

    // Return ownership to owner.
    await financialContractsAdmin.transferOwnership(owner, { from: rando });
  });
});
