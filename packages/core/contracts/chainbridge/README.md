# Chainbridge Cross-chain Communication Protocol

This folder implements a new "beacon" oracle system that allows communication of price request data across EVM-compatible networks. There are two types of beacon oracles: the `SinkOracle` and the `SourceOracle`, deployed on L2 and L1 respectively.

The oracle contracts use Chainbridge to send messages between different chains. In particular, DVM price requests are passed from a `SinkOracle` on L2 to the `SourceOracle` on L1, which communicates with the DVM and resolves the price request via the standard mechanism. Once resolved, the price is pushed back to the `SinkOracle` chain where it can be utilized. This allows UMA financial contracts to be deployed in multiple different chains but still use the Ethereum mainnet DVM to resolve prices as required.

The cross-chain infrastructure also includes contracts that pass governance proposals from the `Governor` contract on L1 to a `SinkGovernor` on L2. Governance proposals are similarly sent through the Chainbridge message bridge.

## Motivation

The security of the DVM depends on UMA token holders voting on mainnet, rendering any price resolutions on mainnet as the final "source of truth". Therefore, any non-mainnet EVM network that wants to either submit or resolve price requests must be able to communicate with the mainnet DVM.

For bridging DVM data to non-Ethereum EVM chains that do NOT already have an arbitrary message bridge, this Chainbridge system can be deployed as a temporary solution where centralized control of the bridge is traded for data availability on the EVM chain.

## Implementation

We have implemented and deployed a [trusted bridge system](https://chainbridge.chainsafe.io/) on other EVM networks so that registered contracts, like `OptimisticOracles`, can submit price requests to "beacon" oracles that will ultimately relay the requests to mainnet via off-chain relayers. The bridge contract system was conceived by Chainbridge and has been cloned into the `UMAprotocol/protocol` repository [here](https://github.com/ChainSafe/chainbridge-solidity/tree/849db5657b8ce7c340a8847078de87d3a9e421f1).

There are no DVMs (`Voting.sol` contracts) deployed to L2; instead we deploy a "beacon" contract called a `SinkOracle`. The purpose of the `SinkOracle` is to send price requests to the L1 DVM and receive corresponding price resolution data from the L1 DVM. A corresponding `SourceOracle` is deployed on L1 that parses price request information before communicating directly with the DVM. Generally, price resolution data flows from `SourceOracle` to `SinkOracle`, while price requests are bubbled up from the `SinkOracle` to the `SourceOracle`.

The relationship between `SinkOracle` and `SourceOracle` is "N-to-1":

- We anticipate that there will be 1 `SourceOracle` deployed to mainnet, and 1 `SinkOracle` deployed to each L2 network that needs to securely obtain prices from L1.
- Each `SinkOracle` will have a unique `chainId` that it will submit with price requests to the `SourceOracle`. This effectively enables a unique communication channel between each `SinkOracle` and the 1 `SourceOracle`.

### Diagram of the architecture:

Theoretical context: `OptimisticOracle` on L2 fails to resolve price optimistically, wants to raise a dispute to the DVM on L1.

L2 price request results in emitting `Deposit` event through `Bridge` contract:

![image](https://user-images.githubusercontent.com/9457025/121192990-736bc380-c83b-11eb-983f-c5ea2c54bfe6.png)

Off-chain relayer bridges `Deposit` data to L1 `Bridge` which forwards request to DVM:

![image](https://user-images.githubusercontent.com/9457025/121193025-7d8dc200-c83b-11eb-8cfa-4b8513ab5f02.png)

DVM resolves price request. Someone detects price resolution and wants to signal (via a `Deposit` event) to off-chain relayer to send resolved price back to L2:

![image](https://user-images.githubusercontent.com/9457025/121193110-8da5a180-c83b-11eb-88b1-defd40d37e1c.png)

Off-chain relayer bridges `Deposit` data to L2 `Bridge` which makes price available to `OptimisticOracle`:

![image](https://user-images.githubusercontent.com/9457025/121193150-96967300-c83b-11eb-9367-912737c93ef0.png)

## Technical Example: bridging a price request from L2 to L1:

- If an `OptimisticOracle` on L2 makes a price request, it will send it to the `SinkOracle`, which will submit a "deposit" to the `Bridge` contract on L2 that will emit a "Deposit" event containing the price request metadata if the deposit is successful. A trusted off-chain "relayer" will detect this "Deposit" event and submit a "deposit" to the `Bridge` contract on L1 with the same price request metadata. The L1 `Bridge` now has the price request information it needs to pass on to the DVM to submit a normal price request.
- The `Bridge` passes the price request data to the `SourceOracle` which makes note of the L2 that submitted the request, before submitting a price request to the DVM.
- Once the DVM resolves the price request, anyone can "publish" the result to the `SourceOracle` and specify which L2 it should communicate the resolved price to. This call simply queries the DVM for the price resolved and copies it to the `SourceOracle`, and therefore it cannot publish a different price than the one resolved.
- On this same publish call, the `SourceOracle` submits a "deposit" to the `Bridge` and will emit a "Deposit" event containing price resolution metadata if the deposit is successful. Again, a trusted off-chain "relayer" will detect the "Deposit" event and submit a deposit to the `Bridge` contract on L2 with the resolved price metadata.
- The `Bridge` on L2 will finally publish the resolved price to the `SinkOracle`, which means that the `OptimisticOracle` on L2 can now fetch a DVM-resolved price.

## How to connect Chainbridge system to DVM in production:

Three governance actions must be taken before this system can be used in production:

- The `SourceOracle` will need to be registered with the `Registry` on Ethereum so that it can make price requests to the DVM. The currently deployed `SourceOracle` can be found.
- The `Bridge` contract address will need to be added to the `Finder` under the name "Bridge". This is how the `SourceOracle` will know which contract to call in order to relay messages to L2.
- The `GenericHandler` contract address will need to be added to the `Finder` under the name "GenericHandler". This contract is a required middle layer for use by the `Bridge` to relay messages from L2 to the `SourceOracle`.

## Security considerations

Please see the individual PRs below for details on how each affects the security of the UMA ecosystem.

The main security risk introduced is that the off-chain relayer has the power to:

- modify price request data before sending from L2 to L1
- modify price resolution data before sending from L1 to L2
- submit spam price requests to the DVM on L1 by calling `Bridge.deposit`
- submit false price resolutions to L2 that did not originate from an L1 price resolution.
- modify governance proposals before sending from L1 to L2

Notably, the ChainBridge system enables the relayer system to eventually grow into a more decentralized federation of trusted relayers, but we anticipate the relayer set to be small to bootstrap the system.

Relevant pull requests:

- Adding the `Bridge` contract: [PR](https://github.com/UMAprotocol/protocol/pull/2894)
- Adding the beacon contracts: [PR](https://github.com/UMAprotocol/protocol/pull/2903)
- Adding cross chain governor conracts: [PR](https://github.com/UMAprotocol/protocol/pull/2969)
- Patching the beacon contracts to prevent spam `Deposit` events: [PR](https://github.com/UMAprotocol/protocol/pull/3032)
- Responding to OpenZeppelin audit on beacon oracle contracts: [PR](https://github.com/UMAprotocol/protocol/pull/3037)
