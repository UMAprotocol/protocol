# DisputeRouter

`packages/core/dispute-router` contains two contracts that add a council-controlled dispute path in front of an underlying UMA oracle such as `OracleChildTunnel`.

- `DisputeRouter`: a UUPS-upgradeable `OracleAncillaryInterface` implementation that stores requests locally, lets its configured council resolve them, and otherwise forwards them to the underlying oracle after a delay.
- `DisputeRouterCouncil`: a non-upgradeable owner-managed wrapper that is typically set as the router's `council` and gives approved operators a narrower surface for managed-request resolution and trusted optimistic-oracle escalation.

## Overview

The typical deployment model is:

```text
[Registered financial contract]
              |
              v
       [DisputeRouter proxy] ------> [OracleChildTunnel / other oracle] ---> [Mainnet DVM]
              ^
              |
     [DisputeRouterCouncil]
              ^
              |
    owner configures operators
```

Key behavior:

- Requests are keyed as `keccak256(abi.encode(identifier, time, ancillaryData))`.
- `requestPrice()` is idempotent for an existing request.
- If `forwardDelay == 0`, the router operates in passthrough mode and forwards on request ingestion.
- If the council resolves locally first, `hasPrice()` and `getPrice()` return the local cached price.
- If a request is forwarded first, the council can no longer resolve it locally.
- The router keeps UMA Registry-based permissioning for requesters and price readers.

## Contracts

### DisputeRouter

`DisputeRouter` is the on-path oracle wrapper used by registered contracts.

Responsibilities:

- Accept `requestPrice()` calls from UMA-registered contracts.
- Cache request metadata locally.
- Allow its configured `council` to resolve locally with `resolvePriceRequest()`.
- Allow anyone to forward after `forwardDelay` with `forwardPriceRequest()`.
- Allow the council to bypass the delay with `escalateNow()`.
- Read prices from local resolution first, then from the underlying oracle if forwarded.

### DisputeRouterCouncil

`DisputeRouterCouncil` is the helper contract that usually owns the router's `onlyCouncil` permissions.

Responsibilities:

- Let the council owner approve and revoke operator addresses.
- Let the council owner configure which identifiers may use the `TOO_EARLY_RESPONSE` sentinel value.
- Let operators locally resolve disputed event-based managed requests as too early through the router.
- Let operators locally resolve disputed event-based managed requests from a settled event-based Managed Optimistic Oracle
  V2 follow-up request.
- Let operators escalate Optimistic Oracle-backed router requests through the router when offchain triage decides the router
  request should bypass `forwardDelay`.
- Support batched owner or operator actions through OpenZeppelin `multicall`.

Council operators are trusted for escalation triage. The managed resolution paths set local router prices, while escalation
only forwards an existing router request to the underlying oracle and leaves the final price to that oracle.
The wrapper is not upgradeable. Only the router uses the UUPS proxy pattern.

## Installation

Install repository dependencies from the repo root before using the package scripts:

```bash
yarn install
```

## Build

From `packages/core`:

```bash
yarn build
yarn dispute-router:build
```

If you want to run raw `forge` commands directly, first create the local Foundry/OZ links used by the dispute-router profile:

```bash
./scripts/SetUpFoundryWithHardhat.sh
FOUNDRY_PROFILE=dispute-router forge build
```

## Test

From `packages/core`:

```bash
yarn test
yarn dispute-router:test
yarn dispute-router:test:gas
yarn dispute-router:test:coverage
```

If you want to run raw `forge` commands directly, first run the setup script:

```bash
./scripts/SetUpFoundryWithHardhat.sh
FOUNDRY_PROFILE=dispute-router forge test
FOUNDRY_PROFILE=dispute-router forge test --gas-report
FOUNDRY_PROFILE=dispute-router forge test -vvv
```

The package test suite includes:

- `test/DisputeRouter.t.sol` for router behavior and forwarding semantics.
- `test/DisputeRouterCouncil.t.sol` for operator management, managed request resolution, and optimistic-oracle escalation flows.

The tests use local harnesses that mimic `OracleChildTunnel` and Optimistic Oracle behavior without real cross-chain messaging.

## Format

From `packages/core`:

```bash
yarn dispute-router:fmt
yarn dispute-router:fmt:check
```

## Deployment

All scripts below are run from `packages/core` with `FOUNDRY_PROFILE=dispute-router`.
Before invoking raw `forge script` directly, run:

```bash
./scripts/SetUpFoundryWithHardhat.sh
```

### Common Environment

```bash
export MNEMONIC="your mnemonic phrase"
export RPC_URL=your_rpc_url
export FINDER=0x...        # UMA Finder
export ORACLE=0x...        # Underlying oracle, for example OracleChildTunnel
export FORWARD_DELAY=3600  # Optional, defaults to 3600. Set to 0 for passthrough mode.
export OWNER=0x...         # Optional, defaults to deployer
```

### Option 1: Deploy Router With Existing Council

Use this when council permissions should point directly at an already deployed address.

Additional environment:

```bash
export COUNCIL=0x...
```

Command:

```bash
# Dry run
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouter \
  --rpc-url $RPC_URL

# Broadcast
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouter \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

### Option 2: Deploy Router And Council Wrapper Together

This is the preferred flow because it deploys `DisputeRouterCouncil`, wires it into the router, and optionally seeds initial operator and early-request configuration.

Additional environment:

```bash
export MOO_V2=0x...                           # ManagedOptimisticOracleV2
export INITIAL_OPERATOR=0x...                # Optional
export EARLY_REQUEST_IDENTIFIERS='["YES_OR_NO_QUERY","MULTIPLE_CHOICE_QUERY"]'
```

Command:

```bash
# Dry run
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouterWithCouncil \
  --rpc-url $RPC_URL

# Broadcast
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouterWithCouncil \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

What the script does:

- Deploys the `DisputeRouter` implementation and proxy.
- Deploys `DisputeRouterCouncil`.
- Configures early-request identifiers and an optional initial operator on the wrapper.
- Calls `DisputeRouter.setCouncil(address(councilWrapper))`.
- Transfers ownership of both contracts to `OWNER` if `OWNER` is not the deployer.

The `MOO_V2` address is an ABI dependency for managed resolution. `DisputeRouterCouncil` is compiled against the
expected `getRequest()` and `stampAncillaryData()` return shapes, so the configured `ManagedOptimisticOracleV2` runtime
must preserve that ABI for this council instance.

### Option 3: Deploy Council Wrapper For An Existing Router

Use this when the router already exists and only the wrapper needs to be added later.

Environment:

```bash
export ROUTER=0x...
export MOO_V2=0x...
export OWNER=0x...                            # Optional, defaults to deployer
export INITIAL_OPERATOR=0x...                 # Optional
export EARLY_REQUEST_IDENTIFIERS='["YES_OR_NO_QUERY","MULTIPLE_CHOICE_QUERY"]'
```

Command:

```bash
# Dry run
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouterCouncil.s.sol:DeployDisputeRouterCouncil \
  --rpc-url $RPC_URL

# Broadcast
FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouterCouncil.s.sol:DeployDisputeRouterCouncil \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

After deploying the wrapper in this mode, the router owner must call `setCouncil()` on the router to point council permissions at the new wrapper.

The configured `MOO_V2` address must be ABI-compatible with the council's managed request interface for the lifetime of
that wrapper.

### Post-Deployment Checklist

- Register downstream requester contracts in the UMA Registry so they can call `requestPrice()`, `hasPrice()`, and `getPrice()` on the router.
- Register the router with the underlying oracle if that oracle requires caller registration.
- If using the wrapper, set or update operators with `setOperator()`.
- If using too-early managed resolution, set allowed identifiers with `setEarlyRequestIdentifier()`.
- If the router is the primary oracle entrypoint for a system, update the Finder or other integration wiring to point at the router proxy.
- Managed resolution assumes Managed Optimistic Oracle V2 resolves disputed requests through this router as its Finder
  `Oracle` implementation.

### Registry Setup

The router checks the UMA `Registry` resolved through `Finder` before allowing callers to use `requestPrice()`, `hasPrice()`, or `getPrice()`.

Example:

```solidity
RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
registry.registerContract(new bytes32[](1), requesterContract);
```

## Public Interfaces

### DisputeRouter

Request ingestion and routing:

```solidity
function requestPrice(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData
) external;

function resolvePriceRequest(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData,
  int256 resolvedPrice
) external;

function forwardPriceRequest(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData
) external;

function escalateNow(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData
) external;

```

Price retrieval:

```solidity
function hasPrice(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData
) external view returns (bool);

function getPrice(
  bytes32 identifier,
  uint256 time,
  bytes memory ancillaryData
) external view returns (int256);

```

Admin:

```solidity
function setCouncil(address newCouncil) external;

function setForwardDelay(uint64 newDelay) external;

function setOracle(address newOracle) external;

```

### DisputeRouterCouncil

Owner-managed configuration:

```solidity
function setOperator(address operator, bool allowed) external;

function setEarlyRequestIdentifier(bytes32 identifier, bool allowed) external;

function multicall(bytes[] calldata data) external returns (bytes[] memory results);

```

Operator actions:

```solidity
function resolveManagedAsTooEarly(
  address requester,
  bytes32 identifier,
  uint256 mooV2RequestTime,
  bytes memory ancillaryData
) external;

function resolveManagedFromSettledFollowUp(
  address requester,
  bytes32 identifier,
  uint256 mooV2RequestTime,
  uint256 followUpRequestTime,
  bytes memory ancillaryData
) external;

function escalateOptimisticOracleRequest(
  bytes32 identifier,
  uint256 dvmRequestTimestamp,
  bytes memory dvmAncillaryData
) external;

```

`resolveManagedAsTooEarly()` uses the constant `TOO_EARLY_RESPONSE = type(int256).min`. The two managed resolution
actions are local price-setting paths for requests the council can handle directly. They infer the router request
timestamp from the target MOOv2 request's event-based proposal time, with the same legacy fallback used by MOOv2 for
requests created before `proposalTime` was populated. `escalateOptimisticOracleRequest()` accepts the router/DVM
ancillary data directly and is the trusted-operator path for requests that should instead go to the underlying oracle
without waiting for `forwardDelay`; it does not locally resolve the request.

## Roles And Access Control

- Router owner: upgrades the router implementation and manages `council`, `forwardDelay`, and `oracle`.
- Router council: the only address allowed to call `resolvePriceRequest()` and `escalateNow()`. That is typically the `DisputeRouterCouncil` contract.
- Council wrapper owner: manages operators and early-request identifier allowlists.
- Council operators: trusted actors that execute managed-request resolution and decide which router requests should
  bypass `forwardDelay` through the wrapper.
- Registered contracts: the only addresses allowed to call router `requestPrice()`, `hasPrice()`, and `getPrice()`.

## Request Lifecycle

Standard delayed-forwarding flow:

```text
1. Registered contract calls DisputeRouter.requestPrice()
2. Router stores the request locally
3. Council has forwardDelay seconds to resolve locally
4. If unresolved, anyone may call DisputeRouter.forwardPriceRequest()
5. Router forwards to OracleChildTunnel or another underlying oracle
6. Once the underlying oracle resolves, DisputeRouter.getPrice() returns that result
```

Council-wrapper flow:

```text
1. A managed or other Optimistic Oracle request leads to a router request with stamped ancillary data
2. An approved operator calls a DisputeRouterCouncil action
3. Managed resolution actions validate the target MOOv2 request was disputed and event-based
4. Managed resolution derives the router timestamp from the MOOv2 request proposal time
5. Managed resolution locally resolves requests that the council can handle
6. Escalation accepts router/DVM ancillary data directly, then forwards operator-selected router requests to the
   underlying oracle
```

Integrators using managed resolution are expected to make `ancillaryData` unique per identifier for semantically
distinct event questions. The council can verify MOOv2 origin, event-based status, proposal-time ordering, and
too-early allowlisting, but it still relies on the integration's ancillary data to bind multiple timestamps for the
same identifier to the same event when those timestamps are intended to resolve to the same price.

Resolution priority:

1. Local router resolution, if present.
2. Underlying oracle resolution, if the request was forwarded.

## Upgrades

`DisputeRouter` is UUPS upgradeable and authorizes upgrades through `onlyOwner`. The implementation constructor only takes `FinderInterface`, so replacement implementations must preserve the same immutable dependency model.

`DisputeRouterCouncil` is deployed as a normal contract and is not upgradeable. Its `mooV2` address is immutable and
managed resolution decodes `getRequest()` according to the council's compiled ABI. If `ManagedOptimisticOracleV2` needs
a breaking ABI change, deploy a new `DisputeRouterCouncil` compiled against the new ABI and have the router owner call
`DisputeRouter.setCouncil(newCouncil)`.

## Development Notes

Relevant package files:

```text
packages/core/dispute-router/
├── src/
│   ├── DisputeRouter.sol
│   └── DisputeRouterCouncil.sol
├── script/
│   ├── DeployDisputeRouter.s.sol
│   ├── DeployDisputeRouterBase.s.sol
│   └── DeployDisputeRouterCouncil.s.sol
└── test/
    ├── DisputeRouter.t.sol
    └── DisputeRouterCouncil.t.sol
```

The package uses the `dispute-router` Foundry profile in `packages/core/foundry.toml` with Solidity `0.8.22` and optimizer runs set to `1000000`.

## References

- [DisputeRouter.sol](./src/DisputeRouter.sol)
- [DisputeRouterCouncil.sol](./src/DisputeRouterCouncil.sol)
- [DeployDisputeRouter.s.sol](./script/DeployDisputeRouter.s.sol)
- [DeployDisputeRouterCouncil.s.sol](./script/DeployDisputeRouterCouncil.s.sol)
- [OracleChildTunnel.sol](../contracts/polygon-cross-chain-oracle/OracleChildTunnel.sol)

## License

AGPL-3.0-or-later
