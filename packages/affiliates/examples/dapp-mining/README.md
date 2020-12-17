# Dapp Mining Examples

This contains examples of how to tag transactions with both Web3 and Ethers libraries.

## Background

"Dapp Mining" is the name of a new program being run by Risk Labs. The goal is to incentivize third party developers
to build Dapps (Decentralized Applications) on top of the UMA infrastructure. Through these Dapp interfaces
we can measure the amount of synthetic tokens minted by "tagging" certain transaction on chain with a developers
address or unique identifier. The incentives come in the form of UMA token airdrops each week to developers who bring in liquidity
into UMA EMP (Expiring Multi Party) contracts. The exact amounts and values of UMA airdroped may vary based on
many factors, but essentially the more liquidity provided through a Dapp, the higher the proportion of weekly
rewards earned.

## How It Works

EMP contracts are designed to allow participants to "mint" synthetic tokens by depositing some form of collateral.
This action can be attributed in a process we are calling "tagging". By tagging a transaction, offchain infrastructure
can track the referrer for a minting action to a particular Dapp developer. This tagging will allow offchain infrastructure to estimate the proportion
of synthetic token liquidty created through each interface and reward the developers proportionally. Every week
a quantity of UMA will be airdropped to the tagged addresses. For more detail on tagging see the examples.

**[Web3 Example](./web3-tagging.js)**
**[Ethers Example](./ethers-tagging.js)**

## Joining The Program

Participation in this Dapp Mining program requires you first whitelist your payout address with the Uma Project.
Once white listed your address can be added to transactions that originate from your Dapp. This program will
not necessarily be available for all EMP contracts, more detail will be provided closer to launch.
