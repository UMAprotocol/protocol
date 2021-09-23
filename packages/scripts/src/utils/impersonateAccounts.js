const hre = require("hardhat");
const { REQUIRED_SIGNER_ADDRESSES } = require("./constants");

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

async function run() {
  await _impersonateAccounts(hre.network, REQUIRED_SIGNER_ADDRESSES);
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}
main();
