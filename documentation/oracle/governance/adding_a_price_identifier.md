# Adding a Price Identifier

## What is a price identifier?

A price identifier is a natural language descriptor of the reference index determining how much collateral is needed for a token sponsor to be properly collateralized. 
Because DVM voters need to be able to vote on the value of this price identifier when disputes are raised, the DVM keeps a list of approved price identifiers. 

An example of a price identifier is “GOLD_APR20”. 
This price identifier would be documented in the UMIP that was approved by the UMA tokenholders. 
That UMIP would contain more information about how to calculate the price identifier. 

## Who controls the list of approved price identifiers?
For each deployment of the DVM, the list of approved price identifiers is controlled by the ```IdentifierWhitelist``` contract.
In local and testnet deployments of the DVM, ```IdentifierWhitelist``` is controlled by a single private key. 
In the mainnet deployment of the DVM, ```IdentifierWhitelist``` is controlled by a decentralized governance process, as described below.

## Adding a price identifier to a local deployment
In a local deployment, your private key controls the ```IdentifierWhitelist``` contract. 
You can therefore add any price identifier desired using the ```IdentifierWhitelist.addSupportedIdentifier```, as described in step 5 of this [tutorial](../synthetic_tokens/tutorials/creating_from_truffle.md). 

## Adding a price identifier to a testnet deployment

## Adding a price identifier to the mainnet deployment
The ```IdentifierWhitelist``` contract in the mainnet deployment of the UMA DVM is controlled by a decentralized governance process. 
To add a new price identifier, UMA token holders must vote and approve the identifier. 

- Step 1: Discuss

If you are building with a price identifier not currently supported by the UMA DVM, you will need to propose it to the community of UMA token holders for a vote. 
You should create an UMIP in which you describe your project and the new price identifier(s) being requested. 
At this time, you do not need to provide an implementation for the addition of a new price identifier. 
For details on how to write a UMIP, please see this document. This UMIP will be discussed by members of the UMA community. 

- Step 2: Get Ready For Vote

In order for the UMIP to move to the next stage of discussion, you should construct an off-chain transaction reflecting the implementation of the addition of a new price identifier and attach it to the UMIP. 
The UMA team will put this UMIP to a UMA tokenholder vote. 
This is achieved by the proposer address, controlled by the UMA team, proposing this UMIP to the governor contract, which initiates a vote on the UMIP. 
The UMA team will simultaneously broadcast in other voter communities (e.g. Slack, Github) that the vote is being initiated. 

- Step 3: Vote

UMA voters will vote on the proposed transaction. Each UMA token represents one vote. If at least 5% of all tokens are used to vote, of which >50% of votes approve the UMIP, the UMIP is considered approved. 

- Step 4: Execute Transaction

Once the price identifier is approved, anyone can tell the governor contract to execute the proposed transaction. 
The governor contract will then execute the transaction, approving the identifier in ```IdentifierWhitelist```.
