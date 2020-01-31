// const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
// const Finder = artifacts.require()
// // Helper Contracts
// const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
// const truffleContract = require("@truffle/contract");
// const ERC20Mintable = truffleContract(ERC20MintableData);
// ERC20Mintable.setProvider(web3.currentProvider);

// contract("ExpiringMultiParty", function(accounts) {
//   it("Empty", async function() {
//     const collateralAddress = await ERC20Mintable.new({ from: accounts[0] });
//     const { toWei } = web3.utils;
//     await ExpiringMultiParty.new(
//       true,
//       "1234567890",
//       "1000",
//       collateralAddress.address,
//       { rawValue: toWei("0.1") },
//       { rawValue: toWei("0.1") },
//       { rawValue: toWei("0.1") },
//       1000
//     );
//   });
// });
