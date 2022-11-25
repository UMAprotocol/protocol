# Polygon <> Ethereum State Transfer

This document describes the architecture of how arbitrary messages can be passed between Ethereum and Polygon. For a more detailed explanation from the Polygon official docs site, go [here](https://docs.polygon.technology/docs/develop/l1-l2-communication/state-transfer/).

# Two-way bridge between Root on Ethereum and Child on Polygon

At a high level we are deploying "Root" and "Child" bridge contracts on both networks that communicate only with each other and the native [state sync](https://docs.polygon.technology/docs/contribute/state-sync/state-sync) infrastructure that Polygon uses to pass data between the Ethereum and Polygon EVM's. Polygon uses "tunnel" to describe what [other](https://docs.tokenbridge.net/amb-bridge/about-amb-bridge) [relayer](https://forum.makerdao.com/t/announcing-the-optimism-dai-bridge-with-fast-withdrawals/6938) [systems](https://developer.offchainlabs.com/docs/inside_arbitrum#bridging) call "bridges".

Diagram of oracle tunnel system: ![image](https://user-images.githubusercontent.com/12886084/121140379-115e8e80-c83a-11eb-89e9-27a694e20814.png).

# Root Tunnel Contract

This contract is deployed on Ethereum and inherits from the official tunnel implementation called the ["FxBaseRootTunnel"](https://github.com/fx-portal/contracts/blob/baed24d22178201bca33140c303e0925661ec0ac/contracts/tunnel/FxBaseRootTunnel.sol) which implements `_processMessageFromChild(bytes memory data)` to receive messages from Polygon and enforces that the message originated from a Polygon transaction that has been provably [checkpointed](https://docs.matic.network/docs/contribute/heimdall/checkpoint/) to Ethereum. Notably, the root tunnel can only communicate with one child tunnel on Polygon, and the child tunnel address cannot be overwritten after being set.

In order to send messages to Polygon, the tunnel contract must be initialized to point to a "FxRoot" contract that is [already deployed](https://etherscan.io/address/0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2#code) to Ethereum. The tunnel contract can send messages to Polygon via the "FxRoot" which has special permission to call `syncState(address receiver, bytes calldata data)` on the ["StateSender" contract](https://etherscan.io/address/0x28e4f3a7f651294b9564800b2d01f35189a5bfbe/advanced#code).

To receive messages from Polygon, the tunnel contract is similarly initialized to point to a ["CheckpointManager"](https://etherscan.io/address/0x86e4dc95c7fbdbf52e33d563bbdb00823894c287) deployed on Ethereum. Checkpoints are snapshots of the [Polygon chain state](https://docs.polygon.technology/docs/contribute/heimdall/checkpoint) that are first validated by the Polygon validator set before being submitted to the "CheckpointManager" on Ethereum. Once a Polygon transaction is checkpointed to Ethereum, its arbitrary message can be used to trigger a function call on the Root Tunnel following an inclusion proof. This line in [FxBaseRootTunnel](https://github.com/fx-portal/contracts/blob/baed24d22178201bca33140c303e0925661ec0ac/contracts/tunnel/FxBaseRootTunnel.sol#L103) implements the inclusion proof verification, and the `_validateAndExtractMessage` internal method must pass before the Root Tunnel can submit a price request to the DVM.

# Child Tunnel Contract

This contract is deployed on Polygon and inherits from the official tunnel implementation called the ["FxBaseChildTunnel"](https://github.com/fx-portal/contracts/blob/baed24d22178201bca33140c303e0925661ec0ac/contracts/tunnel/FxBaseChildTunnel.sol) which implements `_processMessageFromRoot(bytes memory data)` to receive messages from Ethereum. Like the root tunnel, the child tunnel can only communicate with one root tunnel whose address cannot be overwritten after being set.

To send messages to Ethereum, the tunnel contract emits a `MessageSent(bytes message)` event containing the message that can be [passed to the Root tunnel contract](https://github.com/fx-portal/contracts/blob/baed24d22178201bca33140c303e0925661ec0ac/contracts/tunnel/FxBaseRootTunnel.sol#L138) after the transaction that originally emitted the `MessageSent` event has been included in a Checkpoint.

To receive messages from Ethereum, Polygon validators will automatically detect and submit `StateSynced(uint256 id, address contractAddress, bytes data)` to Polygon's "FxChild" contract and execute `onStateReceive(uint256 stateId, bytes _data)`, which will pass the message on to the Child tunnel contract. The Child tunnel must be initialized by pointing to the ["FxChild" contract](https://explorer-mainnet.maticvigil.com/address/0x8397259c983751DAf40400790063935a11afa28a/read-contract) deployed on Polygon which can only be called by the System [Superuser address](https://explorer-mainnet.maticvigil.com/address/0x0000000000000000000000000000000000001001/transactions) on Polygon.

# Types of messages that can be relayed

Any message can be relayed between Polygon and Ethereum provided that they are sent by contracts that implement the Polygon tunnel interface correctly (i.e. they can make calls to FxChild and FxRoot and they implement `_processMessage...` correctly). Each contract that wants to transfer state between Polygon and Ethereum must set up its own tunnel, so the relationship between Child and Root tunnels is 1-to-1. For example, UMA requires at least two tunnels to be set up:

- Oracle Tunnel: Submitting price requests from Polygon to Ethereum and resolving prices from Ethereum to Polygon
- Governor Tunnel: Sending governance actions from Ethereum to Polygon that can be executed on Polygon

# Special Permissions that Tunnel contracts need within UMA system

- Oracle Tunnel: The Root tunnel must be able to submit price requests to the DVM and therefore must be registered with the `Registry`.

# Security Considerations

This system relies on the [Polygon consensus mechanism](https://docs.matic.network/docs/home/architecture/security-models#proof-of-stake-security) secured by validators in a Proof of Stake system. The validator set enforces the integrity of data passed between networks (i.e. downstream users need to trust that the validators are not modifying the arbitrary messages that are being sent between networks).

Moreover, downstream users also rely on off-chain actors to relay messages in a timely fashion. Historically messages are sent once per hour.
