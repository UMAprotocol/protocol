# Token Distributions

This package contains logic for distributing UMA tokens through various mechanisms.

## [EMP Developer Rewards](apps/DeployerRewards.js)

This program is meant to reward developers for deploying UMA Expiring Multiparty contracts on chain.
Tokens minted in these contracts are calculated and proportionally rewarded every week. Currently
a pot of 50,000 UMA tokens are distributed per week.

### How It Works

This functionality uses Bigquery to search through block events and transactions to divide up
UMA tokens prorata to deployers of EMP contracts. The TVL (total value locked) of each EMP is calculated
and compared to determine proportionality.

### Joining The Program

[Program Onboarding Requirements | UMA Docs](https://docs.umaproject.org/developers/devmining-reqs)

## EMP Dapp Mining Rewards

"Dapp Mining" is the name of a new program being run by Risk Labs. The goal is to incentivize third party developers
to build Dapps (Decentralized Applications) on top of the UMA infrastructure. Through these Dapp interfaces
we can measure the amount of synthetic tokens minted by "tagging" certain transaction on chain with a developers
address or unique identifier. The incentives come in the form of UMA token airdrops each week to developers who bring in liquidity
into UMA EMP (Expiring Multi Party) contracts. The exact amounts and values of UMA airdroped may vary based on
many factors, but essentially the more liquidity provided through a Dapp, the higher the proportion of weekly
rewards earned. Typically the total size of Dapp mining rewards will be a percentage of the developer
mining rewards received by the contract that the Dapp mints for.

This reference implementation is also intended to be used by developer miners to create their own Dapp mining programs.
With the same tagging mechanism, developer miners could payout a portion of their rewards to third party application
developers or affiliate marketers.

[Designing an Incentives Program | UMA Docs](https://docs.umaproject.org/developers/designing-incentives)

### How It Works

EMP contracts are designed to allow participants to "mint" synthetic tokens by depositing some form of collateral.
This action can be attributed in a process we are calling "tagging". By tagging a transaction, offchain infrastructure
can track the referrer for a minting action to a particular Dapp developer. This tagging will allow offchain infrastructure to estimate the proportion
of synthetic token liquidty created through each interface and reward the developers proportionally. Every week
a quantity of UMA will be airdropped to the tagged addresses. For more detail on tagging see the examples.

### Joining The Program

Participation in this Dapp Mining program requires you first whitelist your payout address with the UMA Project.
Once white listed your address can be added to transactions that originate from your Dapp. This program will
not necessarily be available for all EMP contracts, more detail will be provided closer to launch.

### Examples

- [How to Tag your transactions for credit](examples/dapp-mining/README.md)

## [Liquidity Mining](liquidity-mining/CalculateBalancerLPRewards.js)

This contains scripts for generating liquidity mining rewards in Balancer or Uniswap pools.
