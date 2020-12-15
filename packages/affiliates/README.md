# Token Distributions

This package contains logic for distributing UMA tokens through various mechanisms.

## [EMP Deployer Rewards](apps/DeployerRewards.js)

This functionality uses Bigquery to search through block events and transactions to divide up UMA tokens prorata to deployers of EMP contracts.

## EMP Interaction Rewards

This is meant to weigh specific actions in EMPs to determine payouts for the referrers of those actions.

## [Liquidity Mining](liquidity-mining/CalculateBalancerLPRewards.js)

This contains scripts for generating liquidity mining rewards in Balancer or Uniswap pools.
