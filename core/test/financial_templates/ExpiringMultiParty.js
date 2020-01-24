const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

contract("ExpiringMultiParty", function(accounts) {
  it("Empty", async function() {
    await ExpiringMultiParty.new("1234", true);
  });
});
