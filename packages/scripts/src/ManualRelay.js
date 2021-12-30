#!/usr/bin/env node

// This script allows you to manually relay a particular across deposit.
// Example:
// NODE_URL_1=https://mainnet.infura.io/v3/SOME_PROJECT_ID NODE_URL_10=https://optimism-mainnet.infura.io/v3/SOME_PROJECT_ID \
//   ./src/ManualRelay.js --chainId 10 --depositId 100 --network mainnet_mnemonic
// Optional env overrides:
//   BRIDGE_ADMIN_ADDRESS
//   BRIDGE_DEPOSIT_ADDRESS
//   L2_END_BLOCK_NUMBER
//
// Note: if you want to run with GCKMS keys, the command will look like this:
// NODE_URL_1=https://mainnet.infura.io/v3/SOME_PROJECT_ID NODE_URL_10=https://optimism-mainnet.infura.io/v3/SOME_PROJECT_ID \
//   GOOGLE_APPLICATION_CREDENTIALS=/your/credentials/file.json ./src/ManualRelay.js --chainId 10 --depositId 100 \
//   --network mainnet_gckms --keys your_gckms_key_name

const argv = require("minimist")(process.argv.slice(), { string: ["depositId", "chainId"] });

const { getWeb3ByChainId } = require("@uma/common");
const { InsuredBridgeL1Client, InsuredBridgeL2Client, Logger } = require("@uma/financial-templates-lib");
const sdk = require("@uma/sdk");
const { getAddress } = require("@uma/contracts-node");

async function main() {
  if (!argv.chainId) {
    throw new Error("You must provide the --chainId argument");
  } else if (!argv.depositId) {
    throw new Error("--depositId argument must be provided");
  }

  const defaultDepositBoxMapping = {
    10: await getAddress("OVM_OETH_BridgeDepositBox", 10),
    42161: await getAddress("AVM_BridgeDepositBox", 42161),
    288: await getAddress("OVM_OETH_BridgeDepositBox", 288),
  };

  const l1Web3 = getWeb3ByChainId(1);
  const l2Web3 = getWeb3ByChainId(Number(argv.chainId));
  const [account] = await l1Web3.eth.getAccounts();
  const latestL2BlockNumber = process.env.L2_END_BLOCK_NUMBER || (await l2Web3.eth.getBlockNumber());

  const l1Client = new InsuredBridgeL1Client(
    Logger,
    l1Web3,
    process.env.BRIDGE_ADMIN_ADDRESS || (await getAddress("BridgeAdmin", 1)),
    sdk.across.constants.RATE_MODELS
  );
  await l1Client.update();

  const l2Client = new InsuredBridgeL2Client(
    Logger,
    l2Web3,
    process.env.BRIDGE_DEPOSIT_ADDRESS || defaultDepositBoxMapping[Number(argv.chainId)],
    Number(argv.chainId),
    latestL2BlockNumber - 9900,
    latestL2BlockNumber
  );
  await l2Client.update();

  const deposit = l2Client.getAllDeposits().find((deposit) => deposit.depositId === Number(argv.depositId));
  if (!deposit) throw new Error(`No deposit found for ${argv.depositId}`);

  const txn = l1Client.bridgePools[deposit.l1Token].contract.methods.relayAndSpeedUp(
    deposit,
    await l1Client.calculateRealizedLpFeePctForDeposit(deposit)
  );

  // Verify the txn goes through.
  await txn.call({ from: account });

  // Send to network.
  await txn.send({ from: account });
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
