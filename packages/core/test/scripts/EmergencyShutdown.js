const EmergencyShutdown = require("../../scripts/EmergencyShutdown");

const MockAdministratee = artifacts.require("MockAdministratee");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");

contract("scripts/EmergencyShutdown.js", function(accounts) {
  const owner = accounts[0];

  it("Emergency shutdown", async function() {
    const administratee = await MockAdministratee.new();

    // Call emergency shutdown
    await EmergencyShutdown.run(owner, administratee.address);

    // Emergency shutdown called.
    assert.equal((await administratee.timesEmergencyShutdown()).toString(), "1");
  });
});
