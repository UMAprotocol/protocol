const path = require("path");

// Resolves the decimals for a collateral token. A decimals override is optionally passed in to override
// the contract's decimal value.
async function _getDecimals(web3, collateralAddress, ERC20) {
  const collateral = new web3.eth.Contract(ERC20.abi, collateralAddress);
  try {
    return (await collateral.methods.decimals().call()).toString();
  } catch (error) {
    throw new Error("Failed to query .decimals() for ERC20" + error.message);
  }
}

function _getContractAddressByName(contractName, networkId) {
  const contractAddressPath = path.normalize(__dirname + "../../../networks/" + networkId + ".json");
  return require(contractAddressPath).find((x) => x.contractName === contractName).address;
}

module.exports = { _getDecimals, _getContractAddressByName };
