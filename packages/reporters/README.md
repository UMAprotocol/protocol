# @uma/reporters

This package contains two UMA reporter bot implementations: `GlobalSummaryReporter` and `SponsorReporter`.

## Installing the package

```bash
yarn global add @uma/reporters
```

## Reporters

The two reporters available are:

1. The `GlobalSummaryReporter` provides tabular statistics about sponsors, token holders, liquidations, and disputes for a particular EMP contract within a specified time period.

1. The `SponsorReporter` provides tabular statistics about specified sponsor wallets for a particular EMP contract, including synthetic debt, backing collateral, synthetic balance, and collateral balance.
