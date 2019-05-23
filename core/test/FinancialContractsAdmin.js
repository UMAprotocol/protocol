const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const truffleAssert = require("truffle-assertions");

const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const MockAdmin = artifacts.require("MockAdmin");

contract("FinancialContractsAdmin", function(accounts) {
  let financialContractsAdmin;
  let mockAdmin;

  const governance = accounts[0];
  const remargin = accounts[1];
  const emergencyShutdown = accounts[2];

  // Corresponds to FinancialContractsAdmin.Roles.
  const remarginRole = "1";
  const emergencyShutdownRole = "2";

  beforeEach(async function() {
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
    mockAdmin = await MockAdmin.new();
  });

  it("Remargin", async function() {
    assert.equal(await mockAdmin.timesRemargined(), "0");

    // Can't call remargin without holding the appropriate role.
    assert(await didContractThrow(financialContractsAdmin.callRemargin(mockAdmin.address, { from: remargin })));

    // Grant the role and verify that remargin can be called.
    await financialContractsAdmin.resetMember(remarginRole, remargin);
    await financialContractsAdmin.callRemargin(mockAdmin.address, { from: remargin });
    assert.equal(await mockAdmin.timesRemargined(), "1");
  });

  it("Emergency Shutdown", async function() {
    assert.equal(await mockAdmin.timesEmergencyShutdown(), "0");

    // Can't call emergencyShutdown without holding the appropriate role.
    assert(
      await didContractThrow(
        financialContractsAdmin.callEmergencyShutdown(mockAdmin.address, { from: emergencyShutdown })
      )
    );

    // Grant the role and verify that emergencyShutdown can be called.
    await financialContractsAdmin.resetMember(emergencyShutdownRole, emergencyShutdown);
    await financialContractsAdmin.callEmergencyShutdown(mockAdmin.address, { from: emergencyShutdown });
    assert.equal(await mockAdmin.timesEmergencyShutdown(), "1");
  });
});
