const { getWeb3 } = require("@uma/common");
const { getAddress } = require("@uma/contracts-node");
const { PROD_NET_ID } = require("./constants");
const hre = require("hardhat");
const { getContract } = hre;
const ERC20 = getContract("ERC20");

// Resolves the decimals for a collateral token. A decimals override is optionally passed in to override
// the contract's decimal value.
async function _getDecimals(web3, collateralAddress) {
  const collateral = new web3.eth.Contract(ERC20.abi, collateralAddress);
  try {
    return (await collateral.methods.decimals().call()).toString();
  } catch (error) {
    throw new Error("Failed to query .decimals() for ERC20" + error.message);
  }
}

function _getContractAddressByName(contractName, networkId) {
  return getAddress(contractName, networkId);
}

async function _setupWeb3() {
  const web3 = getWeb3();
  return { web3, netId: PROD_NET_ID };
}
module.exports = { _getDecimals, _getContractAddressByName, _setupWeb3 };
