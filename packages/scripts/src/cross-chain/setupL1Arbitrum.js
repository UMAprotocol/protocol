// Description:
// - Sets up Arbitrum L1 contracts that enable cross chain Oracle and Governance communication.

// Run:
// - Start mainnet fork in one window with `HARDHAT_CHAIN_ID=1 yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port <PORT>`
// - Be sure to set `NODE_URL_1=<mainnet-provider-url>` and `NODE_URL_42161=<l2-provider-url>` environment variables.
// - In new window, run: `node ./packages/scripts/src/cross-chain/setupL1Arbitrum.js --network mainnet`

const hre = require("hardhat");
const { getContract, deployments, companionNetworks } = hre;
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const { getWeb3 } = require("@uma/common");

async function run() {
  const web3 = getWeb3();
  const { toBN } = web3.utils;
  const accounts = await web3.eth.getAccounts();
  const netId = await web3.eth.net.getId();

  // Contract ABI's
  const Arbitrum_ParentMessenger = getContract("Arbitrum_ParentMessenger");
  const OracleHub = getContract("OracleHub");
  const GovernorHub = getContract("GovernorHub");

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    netId
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxFeePerGas.toString(),
      "gwei"
    )} maxFeePerGas and ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas.toString(),
      "gwei"
    )} maxPriorityFeePerGas`
  );

  const deployedParentMessenger = await deployments.get("Arbitrum_ParentMessenger");
  const messenger = new web3.eth.Contract(Arbitrum_ParentMessenger.abi, deployedParentMessenger.address);
  const deployedOracleHub = await deployments.get("OracleHub");
  const oracleHub = new web3.eth.Contract(OracleHub.abi, deployedOracleHub.address);
  const deployedGovernorHub = await deployments.get("GovernorHub");
  const governorHub = new web3.eth.Contract(GovernorHub.abi, deployedGovernorHub.address);

  console.group(
    "\nReading Arbitrum Inbox transaction params that will be used to send cross chain transactions to the ChildMessenger"
  );
  const [
    refundL2Address,
    defaultL2GasLimit,
    defaultL2GasPrice,
    defaultMaxSubmissionCost,
    messengerOwner,
    oracleHubOwner,
    governorHubOwner,
  ] = await Promise.all([
    messenger.methods.refundL2Address().call(),
    messenger.methods.defaultGasLimit().call(),
    messenger.methods.defaultGasPrice().call(),
    messenger.methods.defaultMaxSubmissionCost().call(),
    messenger.methods.owner().call(),
    oracleHub.methods.owner().call(),
    governorHub.methods.owner().call(),
  ]);
  console.log(`- Refund L2 address: ${refundL2Address}`);
  console.log(`- Default L2 gas limit: ${defaultL2GasLimit.toString()}`);
  console.log(`- Default L2 gas price: ${defaultL2GasPrice.toString()}`);
  console.log(`- Default L2 max submission cost: ${defaultMaxSubmissionCost.toString()}`);
  console.groupEnd();

  // The following calls require that the caller has enough gas to cover each cross chain transaction, which requires
  // at most (l2GasLimit * l2GasPrice + maxSubmissionCost) ETH to be included in the transaction.
  const amountOfCrossChainTransactions = 2;
  const requiredEth = toBN(amountOfCrossChainTransactions)
    .mul(toBN(defaultL2GasLimit.toString()))
    .mul(toBN(defaultL2GasPrice.toString()))
    .add(toBN(defaultMaxSubmissionCost.toString()));
  const userEthBalance = await web3.eth.getBalance(accounts[0]);
  console.log(
    `\n${amountOfCrossChainTransactions} cross chain transactions each require ${requiredEth.toString()} ETH (gasLimit * gasPrice + submissionCost)`
  );
  assert(toBN(userEthBalance).gt(requiredEth), "User has insufficient ETH balance to pay for cross chain transactions");

  // Submit parent messenger transactions:
  assert(
    messengerOwner === accounts[0],
    `Accounts[0] (${accounts[0]}) is not equal to parent messenger owner (${messengerOwner})`
  );
  const deployedOracleSpoke = await companionNetworks.arbitrum.deployments.get("OracleSpoke");
  console.log(`Setting oracle spoke address to ${deployedOracleSpoke.address}...`);
  const setChildOracleSpokeTxn = await messenger.methods
    .setChildOracleSpoke(deployedOracleSpoke.address)
    .send({ from: accounts[0], value: requiredEth });
  console.log(`...txn: ${setChildOracleSpokeTxn.transactionHash}`);
  console.log(`Setting child parent messenger to ${messenger.options.address}...`);
  const setChildParentMessengerTxn = await messenger.methods
    .setChildParentMessenger(messenger.options.address)
    .send({ from: accounts[0], value: requiredEth });
  console.log(`...txn: ${setChildParentMessengerTxn.transactionHash}`);

  // Submit oracle hub transactions:
  assert(
    oracleHubOwner === accounts[0],
    `Accounts[0] (${accounts[0]}) is not equal to oracle hub owner (${oracleHubOwner})`
  );
  console.log(`Setting oracle hub messenger for ID 42161 to ${messenger.options.address}...`);
  const setMessengerTxn = await oracleHub.methods
    .setMessenger(42161, messenger.options.address)
    .send({ from: accounts[0] });
  console.log(`...txn: ${setMessengerTxn.transactionHash}`);

  // Submit governor hub transactions:
  assert(
    governorHubOwner === accounts[0],
    `Accounts[0] (${accounts[0]}) is not equal to governor hub owner (${governorHubOwner})`
  );
  console.log(`Setting governor hub messenger for ID 42161 to ${messenger.options.address}...`);
  const setMessengerTxn2 = await governorHub.methods
    .setMessenger(42161, messenger.options.address)
    .send({ from: accounts[0] });
  console.log(`...txn: ${setMessengerTxn2.transactionHash}`);

  console.log("\n😇 Script Complete!");
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
