# DisputeRouter

`packages/core/dispute-router` contains two contracts that add a council-controlled dispute path in front of an underlying UMA oracle such as `OracleChildTunnel`.

- `DisputeRouter`: a UUPS-upgradeable `OracleAncillaryInterface` implementation that stores requests locally, lets its configured council resolve them, and otherwise forwards them to the underlying oracle after a delay.
- `DisputeRouterCouncil`: a non-upgradeable owner-managed wrapper that is typically set as the router's `council` and gives approved operators a narrower surface for managed-request resolution and trusted optimistic-oracle escalation.

## Overview

This deployment is intended for **Polygon only**. Before deploying on another chain, review both the forwarding budget
and oracle interface compatibility. On Arbitrum, `block.number` tracks an approximation of the Ethereum block number,
so the current budget would apply per L1 block rather than per L2 block; use `ArbSys.arbBlockNumber()` if an L2-block
budget is needed. Unlike `OracleSpoke`, the router does not expose the two-argument `requestPrice`, `hasPrice`, and
`getPrice` overloads used by older financial contracts. Pointing their Finder entry to this router would make those
calls revert.

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
- If `forwardDelay == 0`, the router attempts to forward on ingestion; budget-saturated requests remain cached for retry.
- If the council resolves locally first, `hasPrice()` and `getPrice()` return the local cached price.
- If a request is forwarded first, the council can no longer resolve it locally.
- The router keeps UMA Registry-based permissioning for requesters and price readers.

### Shared forwarding budget

The canonical router proxy permits **1 forwarding call per block by default**, without deployment configuration or a
new initializer. Zero stored configuration activates this default, including after an upgrade. This is an egress
budget, not a maximum number of outstanding disputes.

The router counts **calls only**: it does not impose an ancillary-data size limit or maintain a byte counter.
OOv2 (including Managed OOv2) and Skinny OOv2 already bound stamped ancillary data to 8192 bytes upstream.
That bound is not enforced here for other registered callers; their request sizes must be considered separately.

All three paths share the same meter: automatic passthrough, public `forwardPriceRequest`, and council `escalateNow`
(including council multicalls). Changing caller, timestamp, delay, council, or forwarding oracle does not reset usage.
Only a new block resets the spent counter. The budget is consumed before calling the oracle; a reverted call rolls back both
consumption and the forwarded mark.

When public forwarding or escalation exceeds the budget it reverts with `ForwardBudgetExceeded(block.number)`, leaving
the request pending. In passthrough mode, saturation instead leaves the newly admitted dispute cached and emits
`RequestDeferred(requestId)`. A keeper or anyone else must retry it with `forwardPriceRequest` in a later block with
capacity. Repeating `requestPrice` for the same tuple remains a no-op; it is not a retry operation. `RequestAdded`
contains the tuple needed for retry. The router does not run a keeper or maintain an enumerable FIFO queue.

`forwardBudget()` reports the effective call limit and usage in the current block. The owner may call
`setForwardBudget(maxForwards)` to tune the nonzero call limit; zero/unlimited configurations are rejected.
Changing the limit never clears consumption. Lowering it below already-spent usage prevents additional forwards
until capacity renews. The owner and UUPS upgrade authority remain trusted; increasing the limit is an explicit policy
change, not an unprivileged bypass.

Admissions, local council resolutions, and forwarded price reads are not blocked by saturation. Existing
requests are preserved across upgrades: the meter appends fields to ERC-7201 storage rather than changing the request
mapping layout.

**Scope:** this bounds calls through this proxy, not ancillary-data bytes, complete Polygon receipts or Ethereum exit-proof
gas. Other contracts can add logs to the same transaction; even one passthrough forward can share a large admission
batch's receipt. Keep a nonzero forwarding delay on Polygon and submit forwards in dedicated transactions to separate
transport from ingestion. Neither practice prevents a public forwarder from targeting a dispute with receipt padding;
see [Receipt Padding And Recovery](#receipt-padding-and-recovery). Direct
calls from other contracts still registered with OracleChildTunnel, other router proxies, and a malicious configured
oracle are outside this meter. Review registry access and measure real exit proofs before raising limits. The budget
does not guarantee FIFO fairness, automatic retries, or a maximum settlement delay.

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
- `test/ForwardBudget.t.sol` for the shared forwarding limit, saturation, and retry behavior.

The tests use local harnesses that mimic `OracleChildTunnel` and Optimistic Oracle behavior without real cross-chain messaging.

For the separate OracleHub recovery test against pinned Ethereum and Polygon forks, see [fork-test/README.md](fork-test/README.md).

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
export ORACLE=0x...        # Forwarding oracle, for example OracleChildTunnel
export LEGACY_ORACLE=0x... # Previous oracle; required to settle pre-cutover disputes through the router
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
- Initiates two-step ownership transfers of both contracts to `OWNER` if `OWNER` is not the deployer.

When a transfer is initiated, the deployer remains the owner and `OWNER` is the pending owner. `OWNER` must call
`acceptOwnership()` on both the router proxy and council wrapper to complete the handoff. Verify `owner()` and
`pendingOwner()` on each contract before treating deployment as complete. Router-only deployment initializes the
router directly with `OWNER` and does not need this acceptance step.

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

If `OWNER` differs from the deployer, the council-only script initiates an ownership transfer: `OWNER` must call
`acceptOwnership()` on the wrapper and verify its ownership before the handoff is complete. After deploying the
wrapper in this mode, the router owner must call `setCouncil()` on the router to point council permissions at the new wrapper.

The configured `MOO_V2` address must be ABI-compatible with the council's managed request interface for the lifetime of
that wrapper.

### Post-Deployment Checklist

- Register downstream requester contracts in the UMA Registry so they can call `requestPrice()`, `hasPrice()`, and `getPrice()` on the router.
- Register the router with the underlying oracle if that oracle requires caller registration.
- If using the wrapper, set or update operators with `setOperator()`.
- If using too-early managed resolution, set allowed identifiers with `setEarlyRequestIdentifier()`.
- If the router is the primary oracle entrypoint for a system, update the Finder or other integration wiring to point at the router proxy.
- As part of the same cutover, call `syncUmaParams(identifier, currency)` on every deployed `OptimisticOracleV3`
  instance, using an appropriate identifier and currency for that instance, and verify that `cachedOracle` points to
  the router. OOv3 caches the oracle address: changing Finder alone does not update it. This function is permissionless,
  so without an explicit sync the time at which OOv3 starts using the router depends on whoever calls it next.
- Managed resolution assumes Managed Optimistic Oracle V2 resolves disputed requests through this router as its Finder
  `Oracle` implementation.

### Finder Rollback

Before pointing Finder back to `OracleChildTunnel`, settle all disputes whose prices were resolved locally by the
council and forward all pending router requests, retrying across blocks as required by the forwarding budget. Confirm
that no disputes still depend on a council-only price or an unforwarded router request. Locally resolved requests
cannot subsequently be forwarded, and the tunnel cannot serve their council prices. Requests still pending in the
router have not reached the tunnel either. Rolling Finder back early leaves those disputes and their bonds unsettled
until Finder points to the router again. Refresh every OOv3 instance with `syncUmaParams(identifier, currency)` after
the Finder change and verify its `cachedOracle`.

### Legacy Oracle Fallback

Set `LEGACY_ORACLE` to the OracleChildTunnel currently used by the OO before switching the Finder to the router. Both router deployment options pass this address to the implementation constructor. Keep `ORACLE` equal to
`LEGACY_ORACLE` until **all pre-cutover disputes have settled**, including when considering later `setOracle` calls.
A nonzero `LEGACY_ORACLE` is required to settle pre-cutover disputes through the router.

Requests absent from the router fall back to `legacyOracle.hasPrice/getPrice`, allowing pre-cutover disputes to settle even if their prices arrive after the Finder change. Known router requests continue through council resolution or the forwarding oracle. `setOracle` does not change the legacy fallback.

`legacyOracle` is immutable on the implementation, like VotingV2's `previousVotingContract`. Preserve it when deploying future UUPS implementations. Before changing Finder, register the router proxy in the forwarding and legacy oracle registries. Keep the legacy bridge operational for pending disputes.

Admission of an identical request after cutover can temporarily hide a legacy price, because known router requests no
longer use the fallback. Monitor admitted requests for prices already available in the legacy oracle. If this occurs,
the council can call `escalateNow` (or the corresponding council-wrapper escalation action) to restore access to the
existing price, subject to available forwarding budget. With `ORACLE = LEGACY_ORACLE`, the tunnel does not create a
second DVM request. Changing the forwarding oracle before legacy disputes settle could instead create another DVM
request for the same question.

### Registry Setup

The router checks the UMA `Registry` resolved through `Finder` before allowing callers to use `requestPrice()`, `hasPrice()`, or `getPrice()`.

Example:

```solidity
RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
registry.registerContract(new address[](0), requesterContract);
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

function setForwardBudget(uint32 maxForwards) external;

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

## Receipt Padding And Recovery

The permissionless forwarder controls the entire Polygon transaction containing the tunnel message. A malicious
forwarder can emit enough unrelated logs to make the complete receipt too expensive to prove on Ethereum. This can
target a particular dispute after `forwardDelay`, including a passthrough request deferred by the forwarding budget.
The router remains marked as forwarded, preventing local council resolution, and the child tunnel does not re-emit
the message when the same request is submitted again. Retrying the forward therefore does not recover it.

Keep a nonzero `forwardDelay` on Polygon and have the council forward disputes it cannot resolve before that delay
elapses, using dedicated transactions and allowing for the shared forwarding budget. The public path remains a
fallback and retains the receipt-padding risk. Monitor bridge delivery and unresolved forwarded requests.

If the Polygon-to-Ethereum message cannot be proven, recover the request without that message:

1. Locate the `OracleChildTunnel` **`PriceRequestAdded`** event for the affected forward. Record its exact identifier,
   timestamp, and compressed ancillary-data bytes (`parentAncillaryData`). `PriceRequestBridged` contains the original
   ancillary data, not these compressed bytes. Verify the event against the affected child request and tunnel address.
2. On Ethereum, read the token from `OracleHub.token()` and the current final fee from the Store resolved through its
   Finder. Fund the recovery caller and approve OracleHub for that fee, then call
   `OracleHub.requestPrice(identifier, time, parentAncillaryData)`. This permissionless call submits the same DVM
   question directly and pays the final fee for a new request. Do not hard-code the fee or substitute the original
   ancillary data.
3. Wait for the DVM to resolve that exact question. Then call the permissionless
   `OracleRootTunnel.publishPrice(identifier, time, parentAncillaryData)` on Ethereum. Use the root tunnel paired with
   the affected child tunnel, rather than OracleHub publishing through another chain messenger.
4. Wait for Ethereum-to-Polygon state sync, then verify the child tunnel and router return the resolved price for the
   original request tuple and settle the affected Optimistic Oracle dispute. This return path does not require proving
   the padded Polygon receipt.

This procedure preserves permissionless forwarding and does not reset `forwardedTimestamp` or add a router admin
recovery power. It requires operator intervention, the final fee, gas, DVM resolution, and successful return delivery;
a stranded forward is not automatically recovered.

### Late Delivery After Manual Recovery

If the original stranded exit becomes provable and is delivered after manual recovery, the current contracts handle
the duplicate safely, provided recovery used exactly the same identifier, timestamp, and compressed ancillary data
from `PriceRequestAdded`. The root tunnel only marks never-requested requests as requested, VotingV2 skips requests
that are already pending or resolved, and the child tunnel ignores prices for requests already resolved. Different
ancillary-data bytes identify a separate DVM request; preserve the exact recovery tuple.

### Exit Records And Future Tunnel Migrations

Maintain a persistent record of every exit emitted by `OracleChildTunnel`, including its Polygon block number,
branch mask, receipt log index, and whether it was processed, stranded, or manually recovered. For each manual
recovery, retain the exact identifier, timestamp, and compressed ancillary-data bytes used. Keep these records after
recovery so that future tunnel migrations can account for historical exits.

Polygon's `MessageSent` payload does not bind an exit to a particular L1 receiver. The proof validates the child
tunnel that emitted the log, checkpoint proofs do not expire, and `processedExits` replay protection belongs to each
receiver contract independently. A new root tunnel configured with the existing child tunnel can therefore accept
historical messages, including exits already processed by the old root or recovered manually. Recovery does not
invalidate the original exit proof, and the old root's replay protection does not carry over automatically.

Before activating a replacement root tunnel, ensure that it either rejects exits from before its activation, starts
with the set of already processed or manually recovered exits marked as consumed, or is paired with a new child
tunnel. Pairing a new root with a new child tunnel is the simplest option for isolating historical messages.

## Roles And Access Control

- Router owner: upgrades the router implementation and manages `council`, `forwardDelay`, the nonzero per-block forwarding budget through `setForwardBudget`, and `oracle`.
- Router council: the only address allowed to call `resolvePriceRequest()` and `escalateNow()`. That is typically the `DisputeRouterCouncil` contract.
- Council wrapper owner: manages operators and early-request identifier allowlists.
- Council operators: trusted actors that execute managed-request resolution and decide which router requests should
  bypass `forwardDelay` through the wrapper.
- Registered contracts: the only addresses allowed to call router `requestPrice()`, `hasPrice()`, and `getPrice()`.

Both contracts use two-step ownership transfers: `transferOwnership(newOwner)` sets a pending owner, who must call
`acceptOwnership()` to take control. `renounceOwnership()` reverts on both contracts to prevent accidental loss of
administration; this also protects the router upgrade authority.

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
3. Legacy oracle resolution, only if the request is absent from the router.

## Upgrades

`DisputeRouter` is UUPS upgradeable and authorizes upgrades through `onlyOwner`. The implementation constructor takes `FinderInterface` and `OracleAncillaryInterface legacyOracle`; replacement implementations must preserve both immutable addresses.

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
    ├── DisputeRouterCouncil.t.sol
    └── ForwardBudget.t.sol
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
