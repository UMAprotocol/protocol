const path = require("path");
const { getWeb3 } = require("@uma/common");

// Net ID returned by web3 when connected to a mainnet fork running on localhost.
const HARDHAT_NET_ID = 31337;
// Net ID that this script should simulate with.
const PROD_NET_ID = 1;

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
  Object.keys(accountsToImpersonate).map(async (signer) => {
    const result = await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [accountsToImpersonate[signer]],
    });
    if (!result) throw new Error(`Failed to impersonate account ${accountsToImpersonate[signer]}`);
  });
}

// Set web3 to either hardhat's web3 if we're connected to a local node, or the more broadly used `getWeb3` method
// that is also used by production bots. Note that `getWeb3()` currently invokes the `TruffleConfig/getTruffleConfig`
// method which means that `--network` should be passed in. For example, to run this script with a GCKMS key on
// mainnet run: `HARDHAT_NETWORK=mainnet node ... --network mainnet_gckms --keys KEY-NAME`.
// Set `allowProduction` to false to throw an error if the `hre.web3` netId is not equal to the HARDHAT_NET_ID.
// Return the appropriate web3 instance and network ID to use for the script when reading contract artifacts.
async function _setupWeb3(hre, signersToUnlock, allowProduction = true) {
  let hreNetId = await hre.web3.eth.net.getId();
  if (hreNetId === HARDHAT_NET_ID) {
    console.log("🚸 Connected to a local node, attempting to impersonate accounts on forked network 🚸");
    console.table(signersToUnlock);
    await _impersonateAccounts(hre.network, signersToUnlock);
    console.log("🔐 Successfully impersonated accounts");
    return {
      web3: hre.web3,
      // If detecting that we're connected to a local hardhat node, then assume that we're running the script against
      // a mainnet fork and manually override the script's network ID to the Mainnet ID.
      netId: PROD_NET_ID,
    };
  } else {
    if (!allowProduction)
      throw new Error("This script must be run against a local hardhat node simulating a Mainnet fork");
    else {
      const web3 = getWeb3();
      console.log("📛 Connected to a production node 📛");
      return { web3, netId: await web3.eth.net.getId() };
    }
  }
}
module.exports = { _getDecimals, _getContractAddressByName, _impersonateAccounts, _setupWeb3 };
