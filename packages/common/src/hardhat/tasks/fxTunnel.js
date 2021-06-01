const { task, types } = require("hardhat/config");
const maticPOSClient = new require("@maticnetwork/maticjs").MaticPOSClient({
    maticProvider: "https://rpc-mumbai.matic.today", // replace if using mainnet
    parentProvider: "wss://goerli-light.eth.linkpool.io/ws", // replace if using mainnet
});

task("root-chain-manager-proof", "Generate proof needed to receive data from root chain manager")
  .addParam("hash", "Transaction hash on Polygon that called _sendMessageToRoot", "", types.string)
  .setAction(async function (taskArguments) {
    const { hash } = taskArguments;
    const proof = await maticPOSClient.posRootChainManager.customPayload(
        hash,
        "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036" // SEND_MESSAGE_EVENT_SIG, do not change
    )

    console.log(proof);
  });
