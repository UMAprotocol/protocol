# UMA Oracle Design
Many use-cases for blockchains and smart contracts require trustless access to off-chain information. 
Decentralized financial contracts, for example, require accurate price data for valuation, margining and settlement. 

The mechanism used to report off-chain information to a blockchain or smart contract is typically referred to as an oracle.
Despite a large body of existing research into oracle system design, current approaches are missing one key feature: an economic guarantee around the cost of corrupting an oracle system. 

Economic guarantees around the cost of corrupting blockchain oracles are critical for the development of useful smart contracts, particularly in decentralized finance (DeFi) applications. 
UMA’s Data Verification Mechanism (DVM) oracle constructions guarantees the economic security of a smart contract and oracle system in a fully decentralized and permissionless blockchain setting. 

## UMA’s Approach to the Oracle Problem

UMA’s DVM design embraces the fact that any on-chain oracle can be corrupted — for a price. 
Because there is no "rule of law" on blockchains outside of economic incentives, UMA's DVM relies on a system of economic incentives to ensure that there is no profitable way to corrupt the DVM.

UMA’s DVM introduces a simple economic security framework for evaluating oracles. 
We look at the potential profit from corruption (PfC) and cost of corruption (CoC) of contracts in our system, and have designed a mechanism to ensure that the cost of corrupting the DVM will exceed the potential profit. 
In doing so, we eliminate the economic incentives for corrupting the DVM in the first place. 

This is a 3 step process: 
1. Create a system to measure the Cost of Corruption (CoC)
1. Create a system to measure the Profit from Corruption (PfC)
1. Design a mechanism to keep CoC > PfC and prove it will work

### Step 1: Create a system to measure the Cost of Corruption (CoC)

The DVM uses a Schelling-Point style voting system with tokenized voting rights. 
Token holders vote on price requests that are submitted by contracts registered with it, and they are paid a reward for voting honestly and penalized otherwise. 
As long as there is an honest majority, voters will vote correctly. 
This means the Cost of Corruption is the cost to buy control of 51% of the voting tokens. 
These voting tokens are the UMA project token. 

### Step 2: Create a system to measure the Profit from Corruption (PfC)

To measure the Profit from Corruption, all contracts using the system are required to register with the DVM and report the value that could be stolen if their price feed was corrupted. 
This is the contract-specific PfC value. 
The DVM then sums each contract’s PfC into a system-wide PfC number.

### Step 3: Design a mechanism to keep CoC > PfC and prove it will work 

The CoC > PfC mechanism is enforced by a variable-fee policy. 
Enforcing the CoC > PfC inequality requires keeping the cost of 51% of the participating voting tokens above the system-wide PfC. 
In other words, the total market cap of the participating voting tokens needs to be >50% the system-wide PfC.

The DVM is designed to do this by continuously monitoring this CoC > PfC relationship and initiating programmatic, repeated, token buybacks if the voting token price drops below target. 
All purchased tokens are burned, reducing token supply (which increases the market cap). 
The funds needed to conduct these buybacks are raised by levying pro rata fees on the contracts using the system. 
(Note that the current implementation of the DVM (v1) has not yet implemented the programmatic buy-and-burn process; this is currently a manual process. The DVM will be upgraded to programmatically perform this function in the future.)

Importantly, the DVM system is designed to levy the lowest fees possible while maintaining the CoC > PfC economic guarantee. 
As such, the system is not rent-seeking — it is designed to minimize the fees required to maintain the security of the system. 
A fascinating result of this design is that when market participants expect growth in the future usage of the protocol, this expectation of growth can maintain the CoC > PfC inequality without the DVM levying any fees at all.

For more detailed research on these mechanisms, please look at this [repo](https://github.com/UMAprotocol/research). 

## UMA Project Token

The UMA project token is the voting token for the UMA DVM. 
Owners of the UMA token have the following rights and responsibilities: 

* Vote on price requests raised by financial contracts registered with the DVM
* Register or de-register contract templates with the DVM
* Conduct an emergency shutdown of specific contract deployments
* Approve new price identifiers
* Upgrade core DVM protocol
* Modify DVM parameters

To vote on price requests, voters will be able to use [vote.umaproject.org](vote.umaproject.org) or a CLI tool that will be made public shortly. 

All responsibilities relating to governance of the UMA ecosystem (any responsibility outside of voting on price requests) will be effected via the UMIP (UMA Improvement Proposal) process. 
To read more about UMIPs, please look at this [repo](https://github.com/UMAprotocol/UMIPs). 

The UMA project token will be listed on Uniswap at approximately 15:00 UTC on Wednesday, April 29th. 
See this [blog post](https://medium.com/uma-project/umas-initial-uniswap-listing-afa7b6f6a330) for additional information. 

## Additional Resources

Here are some additional resources regarding the UMA DVM:
* [Explainer](./oracle/architecture.md)
* [Blog post](https://medium.com/uma-project/umas-data-verification-mechanism-3c5342759eb8) on UMA’s DVM design
* [Whitepaper](https://github.com/UMAprotocol/whitepaper/blob/master/UMA-DVM-oracle-whitepaper.pdf) on UMA’s DVM design
* [Research repo](https://github.com/UMAprotocol/research) for optimal fee policy
* [UMIP repo](https://github.com/UMAprotocol/UMIPs) for governance proposals
