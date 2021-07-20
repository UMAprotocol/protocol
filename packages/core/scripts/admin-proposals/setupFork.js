const hre = require("hardhat");
const { _impersonateAccounts } = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("./constants");

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
