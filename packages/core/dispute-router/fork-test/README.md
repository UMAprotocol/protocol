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
