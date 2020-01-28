const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("ExpiringMultiParty", function(accounts) {
  it("Empty", async function() {
      const collateralAddress = await ERC20Mintable.new({from: accounts[0]});
    await ExpiringMultiParty.new("1234", collateralAddress.address, true);
  });
});
