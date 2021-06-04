const { task, types } = require("hardhat/config");
const MaticJs = require("@maticnetwork/maticjs");
require("dotenv").config();

// In order to receive a message on Ethereum from Polygon, `receiveMessage` must be called on the Root Tunnel contract
// with a proof derived from the Polygon transaction hash that was checkpointed to Mainnet.
task("root-chain-manager-proof", "Generate proof needed to receive data from root chain manager")
  .addParam("hash", "Transaction hash on Polygon that called _sendMessageToRoot", undefined, types.string)
  .addOptionalParam("chain", "'testnet' or 'mainnet'", "mainnet", types.string)
  .setAction(async function (taskArguments) {
    const { hash, chain } = taskArguments;
    const maticPOSClient = new MaticJs.MaticPOSClient({
      network: chain === "testnet" ? "testnet" : "mainnet",
      version: chain === "testnet" ? "mumbai" : "v1",
      maticProvider: chain === "testnet" ? "https://rpc-mumbai.matic.today" : "https://rpc-mainnet.matic.network",
      parentProvider:
        chain === "testnet"
          ? `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`
          : `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    });
    // This method will fail if the Polygon transaction hash has not been checkpointed to Mainnet yet. Checkpoints
    // happen roughly every hour.
    const proof = await maticPOSClient.posRootChainManager.customPayload(
      hash,
      "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036" // SEND_MESSAGE_EVENT_SIG, do not change
    );

    console.log(proof);
  });
