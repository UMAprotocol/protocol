// Description:
// - Propose admin transactions manually.

require("dotenv").config();
const { getWeb3ByChainId } = require("@uma/common");
const { setupGasEstimator, proposeAdminTransactions } = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");

// Hardcode this array with admin transaction objects. Tip: you can console.log the `adminProposalTransactions` objects
// in the other admin-proposals scripts.
const adminProposals = [
  // Sending a Finder.changeImplementationAddress transaction to the Polygon finder via the OracleRootTunnel
  {
    to: "0x4F490F4835B3693A8874aee87D7CC242c25DCCAf",
    value: 0,
    data:
      "0x6296932d00000000000000000000000009aea4b2242abc8bb4bb78d537a67a245a7bec640000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000004431f9665e4f7261636c650000000000000000000000000000000000000000000000000000000000000000000000000000bed4c1fc0fd95a2020ec351379b22d8582b904e300000000000000000000000000000000000000000000000000000000",
  },
  // The next three transactions will register a new contract on Ethereum. In order:
  // 1. Add the Governor as a contract creator that can register new contracts
  {
    to: "0x3e532e6222afe9Bcf02DCB87216802c75D5113aE",
    value: 0,
    data:
      "0x74d0a6760000000000000000000000000000000000000000000000000000000000000001000000000000000000000000592349f7dedb2b75f9d4f194d4b7c16d82e507dc",
  },
  // 2. Register the contract
  {
    to: "0x3e532e6222afe9Bcf02DCB87216802c75D5113aE",
    value: 0,
    data:
      "0x66c8c250000000000000000000000000000000000000000000000000000000000000004000000000000000000000000034df79ab1f3cb70445834e71d725f83a6d3e03eb0000000000000000000000000000000000000000000000000000000000000000",
  },
  // 3. Remove Governor as contract creator
  {
    to: "0x3e532e6222afe9Bcf02DCB87216802c75D5113aE",
    value: 0,
    data:
      "0x6be7658b0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000592349f7dedb2b75f9d4f194d4b7c16d82e507dc",
  },
];

async function run() {
  const gasEstimator = await setupGasEstimator();
  const web3 = getWeb3ByChainId(1);

  // Note: If sending any transactions to Arbitrum, ensure that the Arbitrum_ParentMessenger has enough ETH in it to
  // pay for L2 gas costs.
  await proposeAdminTransactions(
    web3,
    adminProposals,
    REQUIRED_SIGNER_ADDRESSES["deployer"],
    gasEstimator.getCurrentFastPrice()
  );
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
