# @uma/merkle-distributor

This package contains a number of serverless functions used to wrap core UMA logic in a serverless consumable format.

## Key packages included:

1. `uma-tvl-calculator` wraps the `merkle-distributor-helper` package's `calculateCurrentTvl` method to create a simple interface for computing the current UMA TVL.
2. `Merkle-distributor-helper` wraps the the `merkle-distributor-helper` package's `getClaimsForAddress` method to create a simple interface to fetch claims for a particular address.

## Using these functions

These serverless functions are designed to work in any serverless framework. They are used by UMA within GCP cloud functions but they should work equally well within Vercel's serverless, AWS Lambda or any other serverless framework of your choosing.
