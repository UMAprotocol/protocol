# Polygon proposer refund and Store withdrawer handover

This proposal refunds **37,875 USDC.e** from the Polygon Store to `0xa0B6210f5B522b97bbcE9B8E617627105c0e3891` and leaves the RL Polygon Safe `0x6ee4D971142afadEa1828445124D6137080B4146` as the Store's sole withdrawer. Amount, recipient, token, contracts and final withdrawer are fixed in `common.ts`; there are no payout overrides.

The refund references the Snapshot proposal [Request to refund 37,875 USDC.e burned by self-disputing 86 poisoned requests](https://snapshot.box/#/s:uma.eth/proposal/0x5e036f2a5848ac5c3e1a966f526c3070c1d7b2963d2bc66b610c22dfe2df11d1). The withdrawer handover is an additional action in this DVM proposal, giving the Safe withdrawal authority while governance retains ownership.

All four mainnet proposal transactions target `GovernorRootTunnel`, with zero ETH value, and relay these Polygon calls in order:

| Index | Call                                        | Result                                              |
| ----- | ------------------------------------------- | --------------------------------------------------- |
| 0     | `Store.resetMember(1, GovernorChildTunnel)` | Replace the HSM withdrawer with governance          |
| 1     | `Store.withdrawErc20(USDC.e, 37875000000)`  | Send the refund to the child tunnel (`msg.sender`)  |
| 2     | `USDC.e.transfer(recipient, 37875000000)`   | Pay the recipient                                   |
| 3     | `Store.resetMember(1, polygonSafe)`         | Replace governance with the Safe as sole withdrawer |

Role 1 is exclusive; replacing its member removes the previous holder. Role 0 remains with `GovernorChildTunnel`, so governance retains the ability to change the withdrawer later. This proposal does not sweep the remaining treasury funds or change roles on other chains.

## Preparation and checks

Run from the repository root with dependencies, generated contract types and Hardhat artifacts available (`yarn`, `yarn build`, `yarn hardhat compile`). The scripts use the existing `NODE_URL_1` and `NODE_URL_137` conventions. Supply endpoint values externally; there is no environment mapping.

Before proposing, review the fixed recipient and Safe with a second reviewer and verify the generated calldata. The scripts check chain IDs, root/child tunnel configuration, governance ownership, the current HSM withdrawer, USDC.e decimals and Store balance, and a valid Safe owner/threshold configuration. They read the current UMA proposal bond and check the proposer's balance before approving it. Safe configuration checks do not replace independent confirmation of the intended recipient and multisig.

Read-only preview (no signer, bond approval or submission):

```sh
DRY_RUN=1 yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/0_Propose.ts --network mainnet --no-compile
```

The proposal script prints the Polygon calls, wrapped mainnet transactions and complete `ProposerV2.propose` calldata. Its explanation describes both the refund and the withdrawer handover.

## Two-chain fork simulation

Start separate Ethereum and Polygon Anvil forks (tested with Anvil 1.7.1, which supports the Hardhat RPC methods used here). Substitute archive RPC endpoints and record the fork block numbers used. The repository's older Hardhat node can reject current RPC block responses that omit `totalDifficulty`; Anvil avoids that fork-server compatibility issue while the scripts still run through Hardhat:

```sh
anvil --fork-url <ETHEREUM_RPC_URL> --fork-block-number <ETHEREUM_BLOCK> --chain-id 1 --port 9545 --auto-impersonate
anvil --fork-url <POLYGON_RPC_URL> --fork-block-number <POLYGON_BLOCK> --chain-id 137 --port 9546
```

In a third terminal, configure the local endpoints and fund/impersonate the existing proposer and voting accounts:

```sh
export NODE_URL_1=http://127.0.0.1:9545
export NODE_URL_137=http://127.0.0.1:9546
unset GCKMS_WALLET
yarn hardhat run packages/scripts/src/utils/seedProposerWithUma.js --network localhost --no-compile
yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/0_Propose.ts --network localhost --no-compile
```

Set `PROPOSAL_ID` to the value printed from the proposal receipt's `NewProposal` event. Simulate the vote without executing, then execute this specific proposal:

```sh
export PROPOSAL_ID=<ID_FROM_PROPOSAL_RECEIPT>
SKIP_EXECUTE=1 yarn hardhat run packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost --no-compile
yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/1_Execute.ts --network localhost --no-compile
```

Execution verifies the selected proposal's four transactions and explanation before sending anything. It batches the L1 calls through `GovernorV2.multicall`. On `localhost`, it first checks both endpoints support Hardhat, then relays the actual L1 `StateSynced` payloads through Polygon's `FxChild.onStateReceive`, using the same system-sender impersonation as the shared `spoofPolygonRelay` helper. The local relay wrapper retains receipts for verification.

The simulation checks Store −37,875, recipient +37,875, unchanged child tunnel balance, unchanged Store owner, and the Safe as sole withdrawer. It also checks that both former withdrawers fail the withdrawal role check and that the Safe passes it. No real Safe signature is exercised by these simulated calls. Record the printed L1 transaction and `POLYGON_EXECUTE_TXS` hashes with the fork blocks and results for review.

## Production submission and execution

Point `NODE_URL_1` and `NODE_URL_137` to the public networks and authenticate GCKMS before submitting. Review the preview and fork evidence first.

```sh
GCKMS_WALLET=deployer yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/0_Propose.ts --network mainnet --no-compile
```

Set the explicit `PROPOSAL_ID` printed by this production submission. Once the DVM approves the proposal:

```sh
GCKMS_WALLET=deployer yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/1_Execute.ts --network mainnet --no-compile
```

L1 execution submits four separate Polygon messages; it does **not** make their Polygon execution atomic or prove successful delivery. Save the printed `L1_EXECUTE_TX` and `POLYGON_FROM_BLOCK` (the Polygon block recorded before L1 submission). Once the relays arrive, verify with:

```sh
export L1_EXECUTE_TX=<L1_EXECUTION_TRANSACTION_HASH>
export POLYGON_FROM_BLOCK=<POLYGON_BLOCK_PRINTED_BEFORE_L1_EXECUTION>
yarn hardhat run packages/scripts/src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/2_Verify.ts --network mainnet --no-compile
```

Verification is read-only. It validates the four L1 `StateSynced` payloads against the fixed proposal, then searches Polygon's `StateCommitted` events by state ID from `POLYGON_FROM_BLOCK` to the current block in 2,000-block queries. It fetches each distinct receipt once and requires all four per-message success flags, the exact four child-tunnel execution events in order, both USDC.e transfers of the exact refund amount, and the final Store roles. A missing message fails verification; wait for delivery and rerun, or check the starting block. A failed message requires inspection before recovery.

Polygon can bundle multiple state syncs into one system transaction, so the four messages may share one transaction hash. The verifier prints the distinct `POLYGON_EXECUTE_TXS` it discovers; there need not be four hashes. System receipt status `1` alone does not prove message success: the `StateCommitted` flags and execution/payment events provide that evidence. Transfer events are used rather than current balance deltas, since fees can accrue and the recipient can move funds after payment.

For the local fork only, run `2_Verify.ts --network localhost --no-compile` with the distinct `POLYGON_EXECUTE_TXS` printed by `1_Execute.ts`. Fork delivery directly calls `FxChild`, bypassing the system receiver and its `StateCommitted` events, so this mode checks execution/payment events and roles without testing production state-sync discovery.

The execution script rejects partially or already executed proposals. If execution or delivery is interrupted, inspect the L1 and Polygon receipts before deciding how to recover; do not resubmit the payout or assume that L1 success means all Polygon calls succeeded. Unexecuted L1 calls and failed Polygon delivery are different recovery cases. After vote resolution, the bond can be returned to the proposer by calling `ProposerV2.resolveProposal(PROPOSAL_ID)`; the older `resolveProposal.js` script targets the legacy Proposer and should not be used here.

## Focused tests

```sh
yarn mocha packages/scripts/test/RefundPolygonProposer.js
```

These offline tests check fixed payload encoding, explicit proposal selection, preconditions and receipt verification failure cases. They complement the two-chain fork simulation; they do not establish current deployed state or bridge delivery.
