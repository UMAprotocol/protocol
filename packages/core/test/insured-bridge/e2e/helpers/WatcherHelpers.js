const exec = require("child_process").exec;

const { getMessagesAndProofsForL2Transaction } = require("@eth-optimism/message-relayer");
const { predeploys } = require("@eth-optimism/contracts");

const { getProviderUrls } = require("./ArtifactsHelper");
const { OVM_STATE_COMMITMENT_CHAIN } = require("./OptimismConstants");

async function waitForL1ToL2Transaction(transactionObject, watcher) {
  await transactionObject.wait(); // Wait for tx on L1 to be included.
  const [msgHash] = await watcher.getMessageHashesFromL1Tx(transactionObject.hash); // Get msgHash from watcher on L1.
  await watcher.getL2TransactionReceipt(msgHash, true); // Wait for the hash to be included on L2.
}

async function waitForL2ToL1Transaction(transactionObject, watcher) {
  await transactionObject.wait(); // Wait for tx on L2 to be included.
  const [msgHash] = await watcher.getMessageHashesFromL2Tx(transactionObject.hash); // Get msgHash from watcher on L2.
  await watcher.getL1TransactionReceipt(msgHash); // Wait for the hash to be included on L1.
}

// The methods below were unfortunately not used in the e2e tests as the docker contains are somewhat flaky when turning
// on and off the relayer. Leaving them here as we might choose to manually relay transactions in the future.

const relayerContainerName = "ops_relayer_1"; // Relayer is normally called this from the optimism docker compose.

function execShellCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { stdio: "inherit" }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

async function stopOptimismRelayer() {
  if (!(await isOptimismRelayerRunning())) return; // If the container is not running, return early
  const output = await execShellCommand(`docker stop ${relayerContainerName}`);
  if (output.stdout.includes("error")) throw new Error("stopping optimism relayer contained an error!");
}
async function startOptimismRelayer() {
  if (await isOptimismRelayerRunning()) return; // If the container is already running, return early
  const output = await execShellCommand(`docker start ${relayerContainerName}`);
  if (output.stdout.includes("error")) throw new Error("starting optimism relayer contained an error!");
}

async function isOptimismRelayerRunning() {
  const output = await execShellCommand(`docker inspect -f '{{.State.Running}}' ${relayerContainerName}`);
  return output.stdout.includes("true"); // stdout will contain true or false if the relayerContainerName is running
}

async function relayMessageFromL2ToL1(transactionHash, l1Messenger, l1Wallet) {
  const messagePairs = await getMessagesAndProofsForL2Transaction(
    getProviderUrls().l1RpcProviderUrl, // l1RpcProviderUrl
    getProviderUrls().l2RpcProviderUrl, // l2RpcProviderUrl
    OVM_STATE_COMMITMENT_CHAIN, // l1StateCommitmentChainAddress
    predeploys.OVM_L2CrossDomainMessenger, // l2CrossDomainMessengerAddress
    transactionHash
  );
  await l1Messenger
    .connect(l1Wallet)
    .relayMessage(
      messagePairs[0].message.target,
      messagePairs[0].message.sender,
      messagePairs[0].message.message,
      messagePairs[0].message.messageNonce,
      messagePairs[0].proof
    );
}

module.exports = {
  startOptimismRelayer,
  stopOptimismRelayer,
  isOptimismRelayerRunning,
  waitForL1ToL2Transaction,
  waitForL2ToL1Transaction,
  relayMessageFromL2ToL1,
};
