#!/usr/bin/env node

// This script allows you to manually relay a particular across deposit.
// Example:
// ./src/ManualRelay.js --chainId 10 --depositId 100
// Optional env overrides:
//   BRIDGE_ADMIN_ADDRESS
//   BRIDGE_DEPOSIT_ADDRESS
//   L2_END_BLOCK_NUMBER

const argv = require("minimist")(process.argv.slice(), { string: ["depositId", "chainId"] });

const { getWeb3, getWeb3ByChainId } = require("@uma/common");
const { InsuredBridgeL1Client, InsuredBridgeL2Client, Logger } = require("@uma/financial-templates-lib");
const sdk = require("@uma/sdk");

const depositBoxMapping = {
  10: "0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96",
  42161: "0xD8c6dD978a3768F7DDfE3A9aAD2c3Fd75Fa9B6Fd",
  288: "0xCD43CEa89DF8fE39031C03c24BC24480e942470B",
};

async function main() {
  if (!argv.chainId) {
    throw new Error("You must provide the --chainId argument");
  } else if (!argv.depositId) {
    throw new Error("--depositId argument must be provided");
  }

  const l1Web3 = getWeb3();
  const l2Web3 = getWeb3ByChainId(Number(argv.chainId));
  const [account] = l1Web3.eth.getAccounts();
  const latestL2BlockNumber = process.env.L2_END_BLOCK_NUMBER | (await l2Web3.eth.getBlockNumber());

  const l1Client = new InsuredBridgeL1Client(
    Logger,
    l1Web3,
    process.env.BRIDGE_ADMIN_ADDRESS | "0x30B44C676A05F1264d1dE9cC31dB5F2A945186b6",
    sdk.across.constants.RATE_MODELS
  );
  await l1Client.update();

  const l2Client = new InsuredBridgeL2Client(
    Logger,
    l2Web3,
    process.env.BRIDGE_DEPOSIT_ADDRESS || depositBoxMapping[Number(argv.chainId)],
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
