const TestnetERC20 = artifacts.require("TestnetERC20");
const { deploy, setToExistingAddress } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  let preAssignedAddress = null;
  if (network.startsWith("mainnet")) {
    // Regular DAI address - the allocateTo method will fail if called on this contract, so it's only here to allow
    // Drizzle to load it without breaking.
    preAssignedAddress = "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359";
  } else if (network.startsWith("ropsten")) {
    // Compound's fake DAI address on ropsten.
    preAssignedAddress = "0xB5E5D0F8C0cbA267CD3D7035d6AdC8eBA7Df7Cdd";
  } else if (network.startsWith("kovan")) {
    // Compound's fake DAI address on kovan.
    preAssignedAddress = "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99";
  } else if (network.startsWith("rinkeby")) {
    // Compound's fake DAI address on rinkeby.
    preAssignedAddress = "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa";
  }

  if (preAssignedAddress) {
    await setToExistingAddress(network, TestnetERC20, preAssignedAddress);
  } else {
    // Deploy if there is no listed address to create a fake DAI token.
    await deploy(deployer, network, TestnetERC20);
  }
};
