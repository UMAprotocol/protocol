const path = require("path");
const { getWeb3 } = require("@uma/common");
const { PROD_NET_ID } = require("./constants");

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

// Add signers to provider so that we can sign from specific wallets.
async function _impersonateAccounts(network, accountsToImpersonate) {
  console.log("🚸 Attempting to impersonate accounts on local forked node 🚸");
  console.table(accountsToImpersonate);

  Object.keys(accountsToImpersonate).map(async (signer) => {
    const result = await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [accountsToImpersonate[signer]],
    });
    if (!result) throw new Error(`Failed to impersonate account ${accountsToImpersonate[signer]}`);
  });

  console.log("🔐 Successfully impersonated accounts");
}

async function _setupWeb3() {
  const web3 = getWeb3();
  return { web3, netId: PROD_NET_ID };
}
module.exports = { _getDecimals, _getContractAddressByName, _impersonateAccounts, _setupWeb3 };
