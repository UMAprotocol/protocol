# OracleHub recovery fork test

From `packages/core`, set `MAINNET_RPC_URL` and `POLYGON_RPC_URL` to archive-capable Ethereum and Polygon RPC endpoints, then run:

```sh
FOUNDRY_PROFILE=dispute-router FOUNDRY_TEST=dispute-router/fork-test \
  forge test --match-contract OracleHubRecoveryForkTest -vv
```

The test pins Ethereum block **26,430,000** and Polygon block **97,470,000**. Missing RPC variables or unavailable historical state fail the test; it does not skip. The separate test directory keeps archive RPC access out of the ordinary unit suite.

The test deploys the router against Polygon's deployed child tunnel and registers it using an impersonated Registry owner. An ordinary public forward is left unrelayed to Ethereum to model a transport outage. It extracts the exact compressed `parentAncillaryData` from the child tunnel's `PriceRequestAdded` event, submits it through the deployed Ethereum `OracleHub`, checks the configured final-fee balance delta and real DVM request admission, then publishes the answer through the deployed `OracleRootTunnel`. The actual emitted `StateSynced` payload is delivered through Polygon's deployed `FxChild`, and the router returns the recovered price without resetting its forwarded state.

Boundaries:

- DVM voting is not simulated: the exact admitted request's `getPrice` response is mocked after verifying that publication reverts while unresolved. The price is a synthetic fixture.
- The recovery account's UMA balance is provisioned with a cheatcode. OracleHub's allowance, fee calculation, transfer to Store, and DVM admission execute normally. The deployed Store has a zero UMA final fee at the pinned Ethereum block, so the expected balance delta is zero; this fixture does not prove a nonzero-fee transfer.
- Polygon system delivery is impersonated; validator transport and automatic state sync are not tested. A non-system delivery attempt must revert.
- This verifies price recovery through the child tunnel and router. It does not reproduce receipt padding, measure exit-proof gas, exercise OO bond settlement, or test governance refunds.

# Polygon cutover fork test

From `packages/core`, set `POLYGON_RPC_URL` to an archive-capable Polygon RPC endpoint, then run:

```sh
FOUNDRY_PROFILE=dispute-router FOUNDRY_TEST=dispute-router/fork-test \
  forge test --match-contract PolygonCutoverForkTest -vv
```

The test pins Polygon block **97,725,000** and uses the deployed DisputeRouter, DisputeRouterCouncil and AccessManager. `setUp` replays the queued Safe MultiSend role setup by impersonating the Safe, grants a test HSM the operator and forwarder roles before the grant delay takes effect, and switches the runtime EVM to Prague because the deployed AccessManager and reporter use opcodes newer than the profile's Paris target. Each test applies the governance cutover as `GovernorChildTunnel` (register the router, then point Finder `Oracle` at it), except the pre-cutover test, which disputes first.

Covered flows:

- OOv2 dispute held by the router; public forward reverts before the 4-day delay and reaches the tunnel after it; DVM answer delivered as `FxChild` from the root tunnel; OOv2 settles with the expected bond payout.
- Polymarket V2 path (OOReporter on Managed OOv2): disputes held; council P4 through `AccessManager.execute` settles them as too early and the reporter re-requests instead of resolving; council copy from a settled follow-up settles the original dispute.
- Council escalation from the HSM and from the backup forwarder, then DVM settlement. OOv1 disputes are held and settle after escalation. Skinny OO is not deployed on Polygon.
- OOv2 and Managed OOv2 disputes raised before the cutover settle afterwards through the router's legacy fallback.
- Unauthorized callers: the backup cannot P4 or copy, strangers cannot act through the AccessManager, council or router, the HSM cannot call the council directly, and unregistered callers cannot request prices.
- Grant-delay window: grants made up to one second before the `RoleGrantDelayChanged` effect timepoint (Safe execution time plus `minSetback()`) are usable immediately; grants at or after that timepoint wait the full 72 hours.

Boundaries: DVM voting and cross-chain transport are not simulated; prices are fixtures. OOv3 keeps its cached tunnel because the proposal does not call `syncUmaParams`, so it is not exercised.
