# UMA Voter Gas Rebate Scripts

This directory contains scripts for calculating gas rebates for UMA protocol voters.

## VoterGasRebateV2.ts

The main script for calculating gas rebates for UMA 2.0 voters. It finds all `VoteCommitted` and `VoteRevealed` events in a specified time range and calculates the gas used for each event. The script aggregates gas rebates by voter and saves the results to a JSON file.

### How It Works

1. Determines the previous month's date range (designed to run monthly)
2. Fetches all `VoteCommitted` and `VoteRevealed` events from the VotingV2 contract in small block chunks
3. Filters out voters with less than the minimum staked tokens
4. Deduplicates commit events (only the first commit per voter per round is refunded)
5. Matches commit events with corresponding reveal events
6. Validates discovered event transactions against receipt logs and splits failed ranges before accepting results
7. Calculates gas rebates (with optional priority fee cap)
8. Saves results to `rebates/Rebate_<N>.json` plus audit reports

### Usage

Use an operator-provided RPC URL for production runs. Do not commit RPC keys, concrete RPC URLs, shell history, or copied commands containing provider credentials. Monthly mode can warn when `CUSTOM_NODE_URL` is not configured; correction/audit mode requires it.

```bash
# Run from the affiliates package directory
cd packages/affiliates

# Normal monthly run for the previous month
CUSTOM_NODE_URL="<mainnet-rpc-url>" \
yarn hardhat run ./gas-rebate/VoterGasRebateV2.ts --network mainnet

# With custom configuration
CUSTOM_NODE_URL="<mainnet-rpc-url>" \
OVERRIDE_FROM_BLOCK=18000000 \
OVERRIDE_TO_BLOCK=18500000 \
MIN_STAKED_TOKENS=1000 \
yarn hardhat run ./gas-rebate/VoterGasRebateV2.ts --network mainnet

# Override the default priority fee cap
CUSTOM_NODE_URL="<mainnet-rpc-url>" \
MAX_PRIORITY_FEE_GWEI=0.001 \
yarn hardhat run ./gas-rebate/VoterGasRebateV2.ts --network mainnet
```

### Environment Variables

| Variable                  | Description                                                        | Default                                   |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `OVERRIDE_FROM_BLOCK`     | Start block number (overrides automatic date-based calculation)    | Auto-calculated from previous month start |
| `OVERRIDE_TO_BLOCK`       | End block number (overrides automatic date-based calculation)      | Auto-calculated from previous month end   |
| `MIN_STAKED_TOKENS`       | Minimum UMA tokens staked to be eligible for rebate                | `1000`                                    |
| `MAX_PRIORITY_FEE_GWEI`   | Maximum priority fee to refund (in gwei)                           | `0.001`                                   |
| `MAX_BLOCK_LOOK_BACK`     | Maximum block range for VotingV2 event queries                     | `250`                                     |
| `TRANSACTION_CONCURRENCY` | Number of concurrent RPC requests for fetching transactions/blocks | `50`                                      |
| `MAX_RETRIES`             | Maximum retry attempts for failed RPC calls                        | `10`                                      |
| `RETRY_DELAY`             | Delay between retries in milliseconds                              | `1000`                                    |

### Safe Chunk Size and Validation

`MAX_BLOCK_LOOK_BACK=250` is the safe default chunk size for VotingV2 rebate runs. The smaller default reduces the chance that a provider silently truncates `eth_getLogs` responses on high-event ranges. The script also validates discovered VotingV2 event transactions against receipt logs and adaptively splits ranges when validation detects missing `VoteCommitted` or `VoteRevealed` logs.

Do not raise `MAX_BLOCK_LOOK_BACK` for production payouts unless the audit report still shows validation passed and the retry/split/anomaly output is understood by the reviewer. If validation fails, the script fails closed and should not produce payout artifacts.

### March 2026 Rebate 66 Rerun

The March 2026 recompute uses the original paid Rebate 66 block range and policy parameters. Replace only the placeholder RPC URL:

```bash
cd packages/affiliates

CUSTOM_NODE_URL="<mainnet-rpc-url>" \
NODE_OPTIONS="--max-old-space-size=24000" \
OVERRIDE_FROM_BLOCK=24558868 \
OVERRIDE_TO_BLOCK=24781026 \
MIN_STAKED_TOKENS=1000 \
TRANSACTION_CONCURRENCY=100 \
MAX_BLOCK_LOOK_BACK=250 \
MAX_PRIORITY_FEE_GWEI=0.001 \
yarn hardhat run ./gas-rebate/VoterGasRebateV2.ts --network mainnet
```

### Output Format

The script outputs a JSON file to `rebates/Rebate_<N>.json` with the following structure:

```json
{
  "votingContractAddress": "0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac",
  "rebate": 63,
  "fromBlock": 23914921,
  "toBlock": 24136052,
  "countVoters": 813,
  "totalRebateAmount": 3.733496328767278,
  "shareholderPayout": {
    "0x156527BC2e57610c23Ac795A1252cAc56453e320": 0.01473407276015984,
    "0x226DAce98e689118D9199246f8DfBc9115d8B034": 0.003304298094274105
  }
}
```

| Field                   | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `votingContractAddress` | Address of the VotingV2 contract                        |
| `rebate`                | Sequential rebate number                                |
| `fromBlock`             | Starting block of the rebate period                     |
| `toBlock`               | Ending block of the rebate period                       |
| `countVoters`           | Number of voters receiving rebates                      |
| `totalRebateAmount`     | Total ETH amount to be rebated                          |
| `shareholderPayout`     | Map of voter addresses to their rebate amounts (in ETH) |

### Monthly Audit Reports

Each successful monthly run also writes:

- `rebates/Rebate_<N>.audit.json`
- `rebates/Rebate_<N>.audit.md`

The audit JSON contains the exact payout total in wei, transaction-level evidence, the effective configuration, block range, event counts, eligible reveal count, matched commit count, transaction count, voter count, event collector stats, validation status, and anomalies. The Markdown report is a concise reviewer summary generated from the same audit object.

Audit JSON files can be very large and are ignored by git. Keep them as local/regenerable evidence unless a reviewer explicitly asks for one to be attached out-of-band. Commit the payout JSON, manifest, and audit Markdown summary.

Reviewers should confirm that event collection validation passed, retry/split counts look reasonable for the RPC provider used, anomalies are understood, and the payout JSON matches the audited total before approving payment.

## AuditVoterGasRebateV2.ts

Correction/audit mode is VotingV2-only. Do not use this script for the legacy UMA 1.0 `VoterGasRebate.js` workflow.

The correction audit script recomputes one or more paid VotingV2 rebate files from a manifest and writes a consolidated top-up payout for positive deltas only. Historical `Rebate_*.json` files are immutable paid records and must not be edited to correct a prior payout. Negative deltas are reported in the audit output but excluded from the payout JSON.

Run from `packages/affiliates`:

```bash
CUSTOM_NODE_URL="<mainnet-rpc-url>" \
AUDIT_MANIFEST=gas-rebate/corrections/<manifest>.json \
yarn hardhat run ./gas-rebate/AuditVoterGasRebateV2.ts --network mainnet
```

Required environment variables:

| Variable          | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `CUSTOM_NODE_URL` | Explicit mainnet RPC URL for correction/audit mode                      |
| `AUDIT_MANIFEST`  | Correction manifest path, relative to `packages/affiliates` or absolute |

Optional environment variables:

| Variable          | Description                                          | Default                  |
| ----------------- | ---------------------------------------------------- | ------------------------ |
| `OUTPUT_DIR`      | Directory for correction payout and audit artifacts  | `gas-rebate/corrections` |
| `ALLOW_OVERWRITE` | Set to `true` to replace existing correction outputs | `false`                  |
| `MAX_RETRIES`     | Maximum retry attempts for failed RPC calls          | `10`                     |
| `RETRY_DELAY`     | Delay between retries in milliseconds                | `1000`                   |

Manifest entries must specify the paid rebate file, rebate number, block range, VotingV2 contract, original min-stake and priority-fee policy, block chunk size, transaction concurrency, and any exact `expectedDeltas` that must be enforced. The script fails before writing outputs when the manifest or paid file schema is invalid, paid files are missing, block ranges overlap, a non-VotingV2 contract is configured, an expected delta does not match exactly, or an output artifact already exists without `ALLOW_OVERWRITE=true`.

### Correction Manifest Schema

Manifests are committed under `gas-rebate/corrections/` and must not contain secrets:

```json
{
  "version": 1,
  "name": "March 2026 Rebate 66 VotingV2 correction",
  "votingContractAddress": "0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac",
  "outputPrefix": "Correction_Rebate_66",
  "audits": [
    {
      "rebateFile": "gas-rebate/rebates/Rebate_66.json",
      "rebateNumber": 66,
      "fromBlock": 24558868,
      "toBlock": 24781026,
      "minStakedTokens": "1000",
      "maxPriorityFeeGwei": "0.001",
      "maxBlockLookBack": 250,
      "transactionConcurrency": 100,
      "notes": "March 2026 VotingV2 rebate recomputation"
    }
  ],
  "expectedDeltas": [
    {
      "rebateNumber": 66,
      "address": "0xf20737e48160a87Dc9D1B26D8B63c796d2F1eA91",
      "deltaWei": "7088051537280779"
    },
    {
      "rebateNumber": 66,
      "address": "0x2a9437DE0cCD4FD7b7D98831213AcedeFC7a1092",
      "deltaWei": "1902006430166225"
    }
  ]
}
```

For older rebate audits, preserve each paid file's original `fromBlock`, `toBlock`, `minStakedTokens`, `maxPriorityFeeGwei`, `maxBlockLookBack`, and `transactionConcurrency`. Do not apply March 2026 parameters to other rebate files unless those were their original policy parameters.

### March 2026 Correction Audit

Run the committed Rebate 66 correction manifest with an operator-provided RPC URL:

```bash
cd packages/affiliates

CUSTOM_NODE_URL="<mainnet-rpc-url>" \
NODE_OPTIONS="--max-old-space-size=24000" \
AUDIT_MANIFEST=gas-rebate/corrections/Rebate_66_Correction_Manifest.json \
yarn hardhat run ./gas-rebate/AuditVoterGasRebateV2.ts --network mainnet
```

The script writes `Correction_Rebate_66.json`, `Correction_Rebate_66.audit.json`, and `Correction_Rebate_66.audit.md` under `gas-rebate/corrections/` unless `OUTPUT_DIR` changes the destination. Correction payout ETH amounts are emitted as decimal strings so they round-trip to exact wei. The `.audit.json` file is intentionally git-ignored because it can contain large transaction-level evidence; commit the correction payout JSON and `.audit.md` reviewer summary.

### Overpayments

Overpayments are not clawed back by this workflow. Report zero and negative deltas in the correction audit, exclude negative deltas from the make-good payout, and escalate for an explicit product or governance decision if a future clawback or netting approach is requested.

### Artifact Review Checklist

- Event collection validation passed for every audited rebate.
- Expected deltas pass exactly, including the March 2026 Rebate 66 checks when that manifest is used.
- Generated payout total equals the positive top-up total in the audit Markdown summary or local audit JSON.
- Correction payout includes only positive deltas; zero and negative deltas are report-only.
- Audit Markdown references the intended manifest, paid files, block ranges, and policy parameters. Keep the larger audit JSON local unless explicitly requested.
- No historical `Rebate_*.json` file was modified.
- No RPC key, concrete RPC URL, `.env` value, or shell history was committed.

### PR Checklist

- No secrets committed.
- Expected deltas pass.
- Validation passed.
- Generated payout total equals audit summary total.
- Historical rebates unchanged.

### Priority Fee Capping

By default, the script fully rebates base fee and caps the priority fee (tip) portion at `0.001` gwei. You can override the cap by setting `MAX_PRIORITY_FEE_GWEI`.

For example, with `MAX_PRIORITY_FEE_GWEI=0.001`:

- If a voter paid a 0.0005 gwei priority fee, they get rebated the full 0.0005 gwei
- If a voter paid a 0.002 gwei priority fee, they only get rebated 0.001 gwei

The base fee is always fully rebated. The default cap encourages voters to use reasonable gas settings while still covering network costs.

## Legacy Scripts

- **VoterGasRebate.js** - Original gas rebate script for UMA 1.0
- **FindBlockAtTimeStamp.js** - Utility to find block numbers at specific timestamps
