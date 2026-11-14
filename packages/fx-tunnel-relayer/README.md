# Fx Tunnel Relayer

This bot is specific to the Polygon-Ethereum communication layer whose architecture can be found [here](https://github.com/UMAprotocol/protocol/blob/2c3d172d4f3787ef6914788e2c0c8c7d3b1ff7fd/packages/core/contracts/polygon/README.md). In summary, the bot listens for events from the Polygon Oracle contract, emitted when a cross-chain price request is submitted, and then relays the price request to the Ethereum Oracle (i.e. the DVM) after the Polygon block containing the event is [checkpointed](https://docs.matic.network/docs/validate/basics/checkpoint-mechanism/) to Ethereum.

# Run

- `yarn build` to compile code.
- Set environment variables including required `CUSTOM_NODE_URL` and `POLYGON_CUSTOM_NODE_URL` values which correspond to Ethereum and Polygon nodes respectively.
- Optionally set SKIP_THRESHOLD_SECONDS (seconds to skip relay when close to end of phase; default 14400 = 4 hours).
- Optionally set MAX_CALLDATA_BYTES (default 120000), CHUNKED_RELAYER_ADDRESS (a `RootTunnelChunkedRelayer` used to
  relay proofs above that limit) and MAX_CHUNKED_PROOF_BYTES (default 360000); see
  [Oversize proofs](#oversize-proofs-and-lookback).
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

# Oversize proofs and lookback

`MAX_CALLDATA_BYTES` defaults to `120000` and must be a positive integer. The limit covers the complete ABI-encoded
`receiveMessage(bytes)` calldata, including its selector, offset, length and padding. Calldata above the limit is never
sent to `receiveMessage` directly. Proofs from Polygon transactions that batch many messages exceed it because the
receipt with all its logs appears twice in the payload.

For an oversize proof the relayer first computes the exit hash exactly as `FxBaseRootTunnel` does
(`keccak256(abi.encodePacked(blockNumber, nibbles(branchMask), logIndex))`) and skips the message at `debug` level if
`processedExits` on the root tunnel is already true, e.g. after a manual relay. Then:

- If `CHUNKED_RELAYER_ADDRESS` is unset, each unprocessed transaction/message pair produces one `warn` per relayer
  instance with its Polygon transaction hash, message index and byte count ("needs manual relay"). The standard
  PagerDuty transports accept `error` and above, so these warnings do not page. A new serverless invocation can warn
  again; there is no persistent suppression store.
- If `CHUNKED_RELAYER_ADDRESS` is set to a `RootTunnelChunkedRelayer` deployment, the relayer splits the payload into
  its RLP list header, items 0-8 and the encoded log index, stores items 0-8 in data contracts of at most 24575 bytes
  with `storeChunk` (one transaction per chunk not yet on chain) and then calls `relay(prefix, chunks, suffix)`, which
  calls `receiveMessage` with the rebuilt proof. Chunks are content addressed, so messages from the same Polygon
  transaction, and runs after an interruption, reuse chunks that are already deployed. Every transaction is checked
  against `MAX_CALLDATA_BYTES` before it is sent. At startup the bot checks that the address has code and that its
  `rootTunnel()` is the `OracleRootTunnel`. A payload that cannot be parsed as a 10-item exit payload falls back to
  the warning above. Storing a full chunk costs about 5.4M gas.
- `MAX_CHUNKED_PROOF_BYTES` (positive integer, default `360000`) bounds the chunked path. The root tunnel's own memory
  cost grows superlinearly with proof size: mainnet-fork measurements of `relay` through the real `OracleRootTunnel`
  were 4.35M gas for 134 KB, 7.35M for 220 KB and 21.1M for 519 KB, above the 16,777,216 per-transaction gas cap. A
  larger proof stores no chunks and logs one `error` per message and relayer instance, "Proof too large to relay on
  Ethereum: needs DVM request outside the tunnel", with the Polygon transaction hash, message index and proof size.
  Already processed exits stay silent.
- The `relay` transaction is simulated only after its chunks are stored. If the simulation fails (a revert or out of
  gas), or if the gas estimate times `runTransaction`'s 1.25 gas-limit buffer is above the per-transaction cap, the bot
  logs an `error` ("Chunked relay failed after storing chunks") with the error message, and does not send. Later runs
  reuse the stored chunks, repeat only the simulation and log the error again until the message is relayed or leaves
  the lookback. The `360000` default comes from these measurements: with the 1.25 buffer, proofs above roughly
  366 KB would fail this check after their chunks are stored.

Logs contain event identifiers and bounded error messages, not proofs, transaction calldata or full receipt/event
objects. Provider URLs and long hexadecimal strings are redacted from error messages before the 2048-character limit.

The lookback starts at the first Polygon block whose timestamp is at or after the latest block timestamp minus `LOOKBACK`.
It no longer assumes Polygon's average block time. Common block-time defaults for other bots are unchanged.

The `processedExits` check covers oversize proofs only, and only while their events are inside the lookback. An age
alert still needs a separate change: inspect checkpointed messages older than a configurable threshold (for example,
6 hours), query `processedExits` for each exit hash (the relayer's `splitExitPayload` computes it from the proof for any
message index), and emit a deduplicated error for unprocessed exits before they leave the lookback. Persist the exit
identity and alert state across serverless runs and keep checking pending exits after they leave the event window.
The bot does not add that monitor.
