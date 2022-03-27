# Fx Tunnel Relayer

This bot is specific to the Polygon-Ethereum communication layer whose architecture can be found [here](https://github.com/UMAprotocol/protocol/blob/2c3d172d4f3787ef6914788e2c0c8c7d3b1ff7fd/packages/core/contracts/polygon/README.md). In summary, the bot listens for events from the Polygon Oracle contract, emitted when a cross-chain price request is submitted, and then relays the price request to the Ethereum Oracle (i.e. the DVM) after the Polygon block containing the event is [checkpointed](https://docs.matic.network/docs/validate/basics/checkpoint-mechanism/) to Ethereum.

# Run

- `yarn build` to compile code.
- Set environment variables including required `CUSTOM_NODE_URL` and `POLYGON_CUSTOM_NODE_URL` values which correspond to Ethereum and Polygon nodes respectively.
- `node ./dist/src/index.js --network mainnet_mnemonic` or `ts-node ./src/index.js --network mainnet_mnemonic`.

# Why is a bot needed to relay messages from Polygon to Ethereum?

Polygon-Ethereum communication differs based on the direction that a message is sent. If a message is sent from Ethereum to Polygon, then the Polygon [State Sync](https://docs.polygon.technology/docs/contribute/state-sync/state-sync/) mechanism takes over. This relies on Polygon validators to detect `StateSynced` events emitted by the Ethereum [StateSender](https://docs.polygon.technology/docs/contribute/state-sync/how-state-sync-works) contract. Validators are incentivized to pick up these events and submit corresponding metadata to a receiver contract on the Polygon network. The metadata includes a target contract and ABI data that the receiver contract can use to forward a smart contract call. Therefore the Ethereum-to-Polygon messaging is handled automatically by Polygon validators.

However, Polygon-to-Ethereum communication requires manual intervention. While validators _continuously_ monitor the `StateSender` contract on Ethereum to relay data from Ethereum to Polygon, they _periodically_ submit a merkle tree containing transaction hashes that facilitate relaying data from Polygon to Ethereum. Once a merkle tree containing a Polygon transaction is submitted to Ethereum, the transaction is said to be "verified" to have happened on Polygon, and corresponding action can be taken on Ethereum.

Once a Polygon transaction is included in a merkle root submitted to Ethereum, the following manual action must be taken to finalize the Polygon-to-Ethereum communication:

- Construct a proof that the transaction has been included in a checkpoint. Example code below, source [here](https://docs.polygon.technology/docs/develop/l1-l2-communication/state-transfer#state-transfer-from-polygon-to-ethereum).

```js
// source code: https://maticnetwork.github.io/matic.js/docs/advanced/exit-util/
// npm i @maticnetwork/maticjs @maticnetwork/maticjs-web3
import MaticJs from "@maticnetwork/maticjs";
import MaticJsWeb3 from "@maticnetwork/maticjs-web3";

MaticJs.use(MaticJsWeb3.Web3ClientPlugin);

const posClient = new MaticJs.POSClient();
await posClient.init({
    network: 'mainnet', // "testnet"
    version: 'v1', // "mumbai"
    parent: {
      provider: mainnetWeb3.provider,
      defaultConfig: {
        from : fromAddress
      }
    },
    child: {
      provider: polygonWeb3.provider,
      defaultConfig: {
        from : fromAddress
      }
    }
});

const proof = await posClient.exitUtil.buildPayloadForExit(
    "0x3cc9f7e675bb4f6af87ee99947bf24c38cbffa0b933d8c981644a2f2b550e66a", // replace with txn hash,
    "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036" // SEND_MESSAGE_EVENT_SIG do not change,
    false // isFast; unclear what this variable does but setting to true requires a "proof API" so I set to False and it works.
)
```

- Call a RootTunnel contract on Ethereum and include the proof as a function parameter to the `receiveMessage(bytes)` function. [Here's](https://etherscan.io/tx/0x45dbe26471107ac1554d0f8c030e2ce58ec458be05b7df6987051f0c423b09c5) an example execution of `receiveMessage` that succesfully bridged a Polygon price request to an Oracle contract on Ethereum. (Note that the Oracle for this example was a `MockOracle`, not the DVM). [This](https://polygonscan.com/tx/0x6a9eca71268c74668bd69f0db250308c771f0983984c86726cc848c441605b86) was the preceding Polygon price request that needed to be included in the checkpoint beforehand.

# Bot algorithm

- Detect `MessageSent` events emitted by the `OracleChildTunnel` on Polygon whenever a cross-chain price request is submitted to it, usually by the `OptimisticOracle` but can be sent by any registered contract.
- Attempt to construct a proof for the transaction hashes containing the `MessageSent` events. This step will fail and exit silently if the hash has not been checkpointed to Ethereum yet.
- Include the proof in a `receiveMessage` function call to the `OracleRootTunnel`. This step will fail and exit silently if the proof has already been included in a call.
