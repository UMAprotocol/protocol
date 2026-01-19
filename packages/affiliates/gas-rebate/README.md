# UMA Voter Gas Rebate Scripts

This directory contains scripts for calculating gas rebates for UMA protocol voters.

## VoterGasRebateV2.ts

The main script for calculating gas rebates for UMA 2.0 voters. It finds all `VoteCommitted` and `VoteRevealed` events in a specified time range and calculates the gas used for each event. The script aggregates gas rebates by voter and saves the results to a JSON file.

### How It Works

1. Determines the previous month's date range (designed to run monthly)
2. Fetches all `VoteCommitted` and `VoteRevealed` events from the VotingV2 contract
3. Filters out voters with less than the minimum staked tokens
4. Deduplicates commit events (only the first commit per voter per round is refunded)
5. Matches commit events with corresponding reveal events
6. Calculates gas rebates (with optional priority fee cap)
7. Saves results to `rebates/Rebate_<N>.json`

### Usage

```bash
# Run from the affiliates package directory
cd packages/affiliates

# Basic usage (uses defaults, calculates for previous month)
yarn hardhat run gas-rebate/VoterGasRebateV2.ts --network mainnet

# With custom configuration
OVERRIDE_FROM_BLOCK=18000000 \
OVERRIDE_TO_BLOCK=18500000 \
MIN_STAKED_TOKENS=1000 \
yarn hardhat run gas-rebate/VoterGasRebateV2.ts --network mainnet

# With priority fee cap (optional)
MAX_PRIORITY_FEE_GWEI=0.001 \
yarn hardhat run gas-rebate/VoterGasRebateV2.ts --network mainnet
```

### Environment Variables

| Variable                  | Description                                                              | Default                                   |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `OVERRIDE_FROM_BLOCK`     | Start block number (overrides automatic date-based calculation)          | Auto-calculated from previous month start |
| `OVERRIDE_TO_BLOCK`       | End block number (overrides automatic date-based calculation)            | Auto-calculated from previous month end   |
| `MIN_STAKED_TOKENS`       | Minimum UMA tokens staked to be eligible for rebate                      | `500`                                     |
| `MAX_PRIORITY_FEE_GWEI`   | Maximum priority fee to refund (in gwei). If not set, no cap is applied. | None (no cap)                             |
| `MAX_BLOCK_LOOK_BACK`     | Maximum block range for paginated event queries                          | `20000`                                   |
| `TRANSACTION_CONCURRENCY` | Number of concurrent RPC requests for fetching transactions/blocks       | `50`                                      |
| `MAX_RETRIES`             | Maximum retry attempts for failed RPC calls                              | `10`                                      |
| `RETRY_DELAY`             | Delay between retries in milliseconds                                    | `1000`                                    |

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

### Priority Fee Capping (Optional)

By default, the script rebates the full gas cost including any priority fee. You can optionally cap the priority fee (tip) portion to prevent rebating excessive tips by setting `MAX_PRIORITY_FEE_GWEI`.

For example, with `MAX_PRIORITY_FEE_GWEI=0.001`:

- If a voter paid a 0.0005 gwei priority fee, they get rebated the full 0.0005 gwei
- If a voter paid a 0.002 gwei priority fee, they only get rebated 0.001 gwei

The base fee is always fully rebated. Enabling a cap can encourage voters to use reasonable gas settings while still covering network costs.

## Legacy Scripts

- **VoterGasRebate.js** - Original gas rebate script for UMA 1.0
- **FindBlockAtTimeStamp.js** - Utility to find block numbers at specific timestamps
