const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const truffleAssert = require("truffle-assertions");

const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const MockAdministratee = artifacts.require("MockAdministratee");

contract("FinancialContractsAdmin", function(accounts) {
  let financialContractsAdmin;
  let mockAdministratee;

  const governance = accounts[0];
  const remargin = accounts[1];
  const emergencyShutdown = accounts[2];

  // Corresponds to FinancialContractsAdmin.Roles.
  const remarginRole = "1";
  const emergencyShutdownRole = "2";

  beforeEach(async function() {
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
    mockAdministratee = await MockAdministratee.new();
  });

  it("Remargin", async function() {
    assert.equal(await mockAdministratee.timesRemargined(), "0");

    // Can't call remargin without holding the appropriate role.
    assert(await didContractThrow(financialContractsAdmin.callRemargin(mockAdministratee.address, { from: remargin })));

    // Grant the role and verify that remargin can be called.
    await financialContractsAdmin.addMember(remarginRole, remargin);
    await financialContractsAdmin.callRemargin(mockAdministratee.address, { from: remargin });
    assert.equal(await mockAdministratee.timesRemargined(), "1");
  });

  it("Emergency Shutdown", async function() {
    assert.equal(await mockAdministratee.timesEmergencyShutdown(), "0");

    // Can't call emergencyShutdown without holding the appropriate role.
    assert(
      await didContractThrow(
        financialContractsAdmin.callEmergencyShutdown(mockAdministratee.address, { from: emergencyShutdown })
      )
    );

    // Grant the role and verify that emergencyShutdown can be called.
    await financialContractsAdmin.resetMember(emergencyShutdownRole, emergencyShutdown);
    await financialContractsAdmin.callEmergencyShutdown(mockAdministratee.address, { from: emergencyShutdown });
    assert.equal(await mockAdministratee.timesEmergencyShutdown(), "1");
  });
});
