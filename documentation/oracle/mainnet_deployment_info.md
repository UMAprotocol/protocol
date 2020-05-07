# Mainnet Deployment Information

## Current DVM Parameters

The current DVM parameters are as follows. The parameters can be adjusted via the introduction of a new [UMIP](../oracle/governance/umips.md).

1. Inflation percentage per vote: 0.05%

- The token supply is inflated on each resolved vote. If the inflation rate is 5%, then that 5% is split pro rata amongst those who voted correctly. This means that on a per-voter bases, the rewards are >= 5% (you get more if fewer people vote).

2. GAT: 5%

- This is the minimum % of tokens that need to participate in a vote for the vote to resolve and not be rolled to the next round of voting.
- Cannot be changed without upgrading Voting.sol.

3. Voting phase length: 24 hours

- Commit and reveal are phases, so this means a _round_ of voting will take twice as long as a phase.
- Cannot be changed without upgrading Voting.sol.

4. Contract tax rate per annum: 0.0%
5. Tax delay penalty per week: 0%
6. Final fee: 0

## Registered Price Identifiers

There are currently no price identifiers registered with the DVM.

## Registered Financial Contracts

There are currently no financial contracts registered with the DVM.
