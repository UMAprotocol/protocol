const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const EmergencyShutdown = require("../../scripts/EmergencyShutdown");

const MockAdministratee = getContract("MockAdministratee");

contract("scripts/EmergencyShutdown.js", function (accounts) {
  beforeEach(async function () {
    await runDefaultFixture(hre);
  });
  const owner = accounts[0];

  it("Emergency shutdown", async function () {
    const administratee = await MockAdministratee.new().send({ from: accounts[0] });

    // Call emergency shutdown
    await EmergencyShutdown.run(owner, administratee.options.address);

    // Emergency shutdown called.
    assert.equal((await administratee.methods.timesEmergencyShutdown().call()).toString(), "1");
  });
});
